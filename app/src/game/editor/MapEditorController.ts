// ============================================================================
// STRIKE 2025 — MapEditorController.ts
// Mode BUILD (éditeur de map) : caméra libre (pointer lock + ZQSD/WASD,
// Espace/Ctrl monter-descendre, Shift rapide), fantôme de placement aimanté à
// la grille (0.25 m) posé par raycast sur la map et les objets déjà placés.
//  - Clic gauche : placer (objet de palette OU objet porté)
//  - Clic droit  : supprimer l'objet visé — objets placés ET boîtes de la
//                  MAP DE BASE (containers, caisses, murs… tout MAP_BOXES)
//  - E           : saisir l'objet visé pour le DÉPLACER (base comprise)
//  - Molette     : échelle (X/T/V = un seul axe, B = reset)
//  - R           : rotation 90° · Ctrl+Z : annuler
// Les boîtes de base étant rendues en géométrie fusionnée, un groupe de
// PROXIES de picking (une boîte invisible par élément, jamais rendue) permet
// de viser chaque élément individuellement.
// Sauvegarde via POST /mapedit/objects — le serveur persiste (avec garde de
// MAP_VERSION pour les éditions de base), applique les collisions et rediffuse.
// ============================================================================

import * as THREE from 'three';
import type {
  BaseTerrain,
  ClassId,
  ClassLoadouts,
  CustomPropDef,
  MapBaseEdit,
  PlacedObject,
  WeaponId,
  WeaponModelMod,
  WeaponModsConfig,
  WeaponStatsMod,
} from '../../shared/protocol';
import { loadWeaponModel, setWeaponModelMods } from '../render/WeaponModels';
import { MAP_BOUNDS } from '../../shared/map';
import {
  MAP_OBJECT_DEFS,
  MAX_CUSTOM_PROPS,
  MAX_PLACED_OBJECTS,
  SCALE_MAX,
  SCALE_MIN,
  baseSizeForKind,
  editedBaseBoxes,
  editedBaseIndices,
  effectiveBaseBoxes,
} from '../../shared/mapObjects';
import type { Renderer } from '../render/Renderer';
import type { MapBuilder } from '../render/MapBuilder';

const GRID = 0.25;
const FLY_SPEED = 11;
const FLY_FAST = 3;
const LOOK_SENS = 0.0024;
const MAX_PLACE_DIST = 60;
/** Dimensions min/max d'une boîte de base retaillée (m). */
const BASE_DIM_MIN = 0.1;
const BASE_DIM_MAX = 45;

/** Palette telle qu'elle était avant une saisie (restaurée ensuite). */
interface PaletteState {
  kind: string;
  rot: 0 | 1 | 2 | 3;
  scale: [number, number, number];
}

/** Objet SAISI (il reste affiché à sa place — le fantôme montre la
 *  destination ; rien n'est modifié avant le dépôt). */
type Carried =
  | { type: 'custom'; id: number; prev: PaletteState }
  | { type: 'base'; idx: number; dims: [number, number, number]; prev: PaletteState };

/** État exposé à l'UI React (palette). */
export interface EditorUIState {
  kind: string;
  rot: number;
  count: number;
  baseEditCount: number;
  dirty: boolean;
  locked: boolean;
  saving: boolean;
  lastSaveOk: boolean | null;
  /** Message d'échec de sauvegarde (ex. code admin requis), sinon null. */
  lastSaveError: string | null;
  /** Échelle courante du fantôme [x, y, z]. */
  scale: [number, number, number];
  /** 'custom' | 'base' | null — objet en cours de déplacement (touche E). */
  carrying: 'custom' | 'base' | null;
}

export class MapEditorController {
  private readonly renderer: Renderer;
  private readonly mapBuilder: MapBuilder;
  private readonly canvas: HTMLCanvasElement;

  active = false;
  /** Callback UI (React) — rappelée à chaque changement d'état visible. */
  onChange: (() => void) | null = null;

  private objects: PlacedObject[] = [];
  private baseEdits: MapBaseEdit[] = [];
  /** Mods d'armes en cours d'édition (armurerie). */
  weaponMods: WeaponModsConfig = {};
  /** Loadouts remappés en cours d'édition (armurerie). */
  loadouts: ClassLoadouts = {};
  /** Props custom du pack (objets de map importés). */
  props: CustomPropDef[] = [];
  /** Terrain de départ du pack. */
  baseTerrain: BaseTerrain = 'kestrel';
  private nextId = 1;
  private kind = 'crate';
  private rot: 0 | 1 | 2 | 3 = 0;
  /** Échelle du fantôme palette (appliquée au prochain placement). */
  private scale: [number, number, number] = [1, 1, 1];
  private carried: Carried | null = null;
  private dirty = false;
  private saving = false;
  private lastSaveOk: boolean | null = null;
  private lastSaveError: string | null = null;
  private undoStack: { objects: PlacedObject[]; baseEdits: MapBaseEdit[] }[] = [];

  // Caméra libre
  private yaw = 0.6;
  private pitch = -0.5;
  private readonly pos = new THREE.Vector3(10, 12, 18);
  private readonly keys = new Set<string>();
  private locked = false;

  // Placement
  private readonly raycaster = new THREE.Raycaster();
  private ghost: THREE.Mesh;
  private readonly ghostEdges: THREE.LineSegments;
  private ghostValid = false;
  private readonly ghostPos = new THREE.Vector3();
  /** Proxies de picking des boîtes de base (détachés de la scène, jamais
   *  rendus — uniquement raycastés ; userData.baseIdx = index d'origine). */
  private pickGroup: THREE.Group | null = null;
  /** Surbrillance de l'objet visé (contour) — la « sélection » est visible. */
  private readonly highlightBox = new THREE.Box3();
  private highlight: THREE.Box3Helper;

  // --------------------------------------------------------------------------
  // Listeners (attachés à enter(), retirés à exit())
  // --------------------------------------------------------------------------

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.active || !this.locked) return;
    this.yaw -= e.movementX * LOOK_SENS;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK_SENS, -1.5, 1.5);
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.active || !this.locked) return;
    if (e.button === 0) {
      // Clic gauche : POSER l'objet porté, ou PLACER un objet de palette.
      this.place();
    } else if (e.button === 2) {
      // Clic droit : SAISIR l'objet visé ; pendant un port : ANNULER.
      if (this.carried) this.cancelCarry();
      else this.grabTargeted();
    }
  };
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    // Undo : Ctrl+Z via e.key (INDÉPENDANT de la disposition clavier — sur
    // AZERTY la touche marquée Z a le code physique KeyW) — ou U sans
    // modificateur (aucun conflit possible avec le déplacement).
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.repeat) return;
      // En cours de déplacement : annule le déplacement.
      if (this.carried) this.cancelCarry();
      else this.undo();
      return;
    }
    this.keys.add(e.code);
    if (e.repeat) return; // les actions ci-dessous ne se répètent pas
    if (e.code === 'KeyU') {
      if (this.carried) this.cancelCarry();
      else this.undo();
      return;
    }
    if (e.code === 'KeyR') this.rotate();
    if (e.code === 'KeyE' && this.locked) {
      // Alias clavier du clic droit : saisir / annuler.
      if (this.carried) this.cancelCarry();
      else this.grabTargeted();
    }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this.locked) {
      this.deleteTargeted();
    }
    if (e.code === 'KeyB') this.resetScale();
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.active || !this.locked || e.deltaY === 0) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    // Axe ciblé si X / T / V est maintenu, sinon échelle uniforme.
    const axes: [boolean, boolean, boolean] =
      this.keys.has('KeyX') ? [true, false, false]
      : this.keys.has('KeyT') ? [false, true, false]
      : this.keys.has('KeyV') ? [false, false, true]
      : [true, true, true];
    if (this.carried?.type === 'base') {
      // Boîte de base : les dimensions sont retaillées directement.
      for (let i = 0; i < 3; i++) {
        if (!axes[i]) continue;
        this.carried.dims[i] = Math.round(
          THREE.MathUtils.clamp(this.carried.dims[i] * factor, BASE_DIM_MIN, BASE_DIM_MAX) * 100,
        ) / 100;
      }
    } else {
      for (let i = 0; i < 3; i++) {
        if (!axes[i]) continue;
        this.scale[i] = Math.round(
          THREE.MathUtils.clamp(this.scale[i] * factor, SCALE_MIN, SCALE_MAX) * 100,
        ) / 100;
      }
    }
    this.rebuildGhost();
    this.emit();
  };
  private readonly onCanvasClick = (): void => {
    if (this.active && !this.locked) {
      this.canvas.requestPointerLock();
    }
  };
  private readonly onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    this.keys.clear();
    this.emit();
  };

  constructor(renderer: Renderer, mapBuilder: MapBuilder, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.mapBuilder = mapBuilder;
    this.canvas = canvas;

    // Fantôme : boîte translucide ambre + arêtes.
    const mat = new THREE.MeshBasicMaterial({
      color: '#F59E1F',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    this.ghost.visible = false;
    this.ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: '#F59E1F' }),
    );
    this.ghost.add(this.ghostEdges);
    this.renderer.scene.add(this.ghost);
    // Contour de sélection (objet visé — saisissable au clic droit / E).
    this.highlight = new THREE.Box3Helper(this.highlightBox, new THREE.Color('#58A6E8'));
    this.highlight.visible = false;
    this.renderer.scene.add(this.highlight);
    this.rebuildGhost();
  }

  // --------------------------------------------------------------------------
  // Cycle de vie
  // --------------------------------------------------------------------------

  /** Entre en mode éditeur : charge l'état existant + attache l'input. */
  enter(): void {
    if (this.active) return;
    this.active = true;
    this.dirty = false;
    this.lastSaveOk = null;
    this.undoStack = [];
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onLockChange);
    void fetch('/mapedit/objects', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { objects?: PlacedObject[]; baseEdits?: MapBaseEdit[]; weaponMods?: WeaponModsConfig; loadouts?: ClassLoadouts; props?: CustomPropDef[]; baseTerrain?: BaseTerrain }) => {
        this.objects = Array.isArray(data.objects) ? data.objects : [];
        this.baseEdits = Array.isArray(data.baseEdits) ? data.baseEdits : [];
        this.weaponMods = typeof data.weaponMods === 'object' && data.weaponMods !== null ? data.weaponMods : {};
        this.loadouts = typeof data.loadouts === 'object' && data.loadouts !== null ? data.loadouts : {};
        this.props = Array.isArray(data.props) ? data.props : [];
        this.baseTerrain = data.baseTerrain === 'flat' ? 'flat' : 'kestrel';
        this.nextId = this.objects.reduce((m, o) => Math.max(m, o.id), 0) + 1;
        this.applyLocal();
      })
      .catch(() => {
        this.objects = [];
        this.baseEdits = [];
        this.weaponMods = {};
        this.loadouts = {};
        this.props = [];
        this.baseTerrain = 'kestrel';
        this.applyLocal();
      });
    this.emit();
  }

  /** Sort du mode éditeur (les visuels édités restent affichés). */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    if (this.carried) this.cancelCarry(); // jamais de perte d'objet en sortie
    this.closePreview();
    this.ghost.visible = false;
    this.highlight.visible = false;
    this.keys.clear();
    this.disposePickGroup();
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('click', this.onCanvasClick);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    if (this.locked && document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  /** Applique l'état local : visuels (base éditée + objets) + proxies picking. */
  private applyLocal(): void {
    this.mapBuilder.setTerrain(this.baseTerrain);
    this.mapBuilder.setBaseBoxes(effectiveBaseBoxes({ baseEdits: this.baseEdits, baseTerrain: this.baseTerrain }));
    this.mapBuilder.setCustomObjects(this.objects, this.props);
    this.rebuildPickGroup();
    this.emit();
  }

  private disposePickGroup(): void {
    if (!this.pickGroup) return;
    this.pickGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.pickGroup = null;
  }

  /** Proxies de picking : une boîte par élément de base (détachées — jamais
   *  rendues), matrices calculées une fois (statiques). */
  private rebuildPickGroup(): void {
    this.disposePickGroup();
    const g = new THREE.Group();
    // Terrain vide : murs d'enceinte non éditables -> aucun proxy de base.
    const boxes = this.baseTerrain === 'flat' ? [] : editedBaseBoxes(this.baseEdits);
    const indices = this.baseTerrain === 'flat' ? [] : editedBaseIndices(this.baseEdits);
    const mat = new THREE.MeshBasicMaterial();
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const sx = b.max.x - b.min.x;
      const sy = b.max.y - b.min.y;
      const sz = b.max.z - b.min.z;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      mesh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      mesh.userData.baseIdx = indices[i];
      g.add(mesh);
    }
    g.updateMatrixWorld(true);
    this.pickGroup = g;
  }

  // --------------------------------------------------------------------------
  // Boucle (appelée par GameClient.frame quand phase === 'editor')
  // --------------------------------------------------------------------------

  update(dt: number): void {
    // Vol libre.
    const speed = FLY_SPEED * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? FLY_FAST : 1);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('KeyZ') || this.keys.has('ArrowUp')) move.add(fwd);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(fwd);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(right);
    if (this.keys.has('KeyA') || this.keys.has('KeyQ') || this.keys.has('ArrowLeft')) move.sub(right);
    // Descendre : C uniquement (Ctrl est réservé aux raccourcis type Ctrl+Z).
    if (this.keys.has('Space')) move.y += 1;
    if (this.keys.has('KeyC')) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      this.pos.add(move);
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, MAP_BOUNDS.minX - 15, MAP_BOUNDS.maxX + 15);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, MAP_BOUNDS.minZ - 15, MAP_BOUNDS.maxZ + 15);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, 0.5, 60);

    const cam = this.renderer.camera;
    cam.position.copy(this.pos);
    cam.rotation.set(this.pitch, this.yaw, 0);
    this.renderer.setFov(this.renderer.baseFov);

    // Fantôme de placement : raycast au centre de l'écran.
    this.updateGhost();
    this.updateHighlight();

    // Aperçu d'arme (armurerie) : flotte devant la caméra, vue de profil.
    if (this.previewGroup) {
      const dir = new THREE.Vector3();
      this.renderer.camera.getWorldDirection(dir);
      this.previewGroup.position.copy(this.pos).addScaledVector(dir, 1.8);
      this.previewGroup.rotation.y = this.yaw + Math.PI / 2;
    }
  }

  /** Contour bleu : objet visé (saisissable), ou objet SAISI (il reste en
   *  place pendant qu'on choisit sa destination). */
  private updateHighlight(): void {
    if (!this.locked) {
      this.highlight.visible = false;
      return;
    }
    let mesh: THREE.Object3D | undefined;
    if (this.carried) {
      // Contour sur l'objet saisi (toujours affiché à sa place d'origine).
      mesh =
        this.carried.type === 'custom'
          ? this.mapBuilder.customObjectsGroup?.children.find(
              (c) => c.userData.objId === (this.carried as { id: number }).id,
            )
          : this.pickGroup?.children.find(
              (c) => c.userData.baseIdx === (this.carried as { idx: number }).idx,
            );
    } else {
      const target = this.targetAtCrosshair();
      if (target) {
        mesh =
          target.type === 'custom'
            ? this.mapBuilder.customObjectsGroup?.children.find((c) => c.userData.objId === target.objId)
            : this.pickGroup?.children.find((c) => c.userData.baseIdx === target.baseIdx);
      }
    }
    if (!mesh) {
      this.highlight.visible = false;
      return;
    }
    this.highlightBox.setFromObject(mesh);
    this.highlight.visible = true;
  }

  /** Dimensions du fantôme : palette × échelle, ou boîte de base portée. */
  private ghostSize(): [number, number, number] | null {
    if (this.carried?.type === 'base') return this.carried.dims;
    const size = baseSizeForKind(this.kind, this.props);
    if (!size) return null;
    return [size[0] * this.scale[0], size[1] * this.scale[1], size[2] * this.scale[2]];
  }

  private updateGhost(): void {
    const size = this.ghostSize();
    if (!size || !this.locked) {
      this.ghost.visible = false;
      this.ghostValid = false;
      return;
    }
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.renderer.camera);
    this.raycaster.far = MAX_PLACE_DIST;
    const hits = this.raycaster.intersectObject(this.mapBuilder.group, true);
    const hit = hits.find((h) => h.object !== this.ghost && h.object !== this.ghostEdges);
    let px: number;
    let pz: number;
    let baseY: number;
    if (hit) {
      // Base : sur une face horizontale on pose AU-DESSUS ; sinon au sol.
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
      baseY = n && n.y > 0.5 ? hit.point.y : 0;
      px = hit.point.x;
      pz = hit.point.z;
    } else if (this.carried) {
      // Objet porté : TOUJOURS plaçable — 10 m devant la caméra (jamais
      // « perdu » en visant le ciel).
      const dir = new THREE.Vector3();
      this.renderer.camera.getWorldDirection(dir);
      const p = this.renderer.camera.position.clone().addScaledVector(dir, 10);
      px = p.x;
      pz = p.z;
      baseY = p.y - size[1] / 2;
    } else {
      this.ghost.visible = false;
      this.ghostValid = false;
      return;
    }
    if (baseY < 0) baseY = 0;
    const x = Math.round(px / GRID) * GRID;
    const z = Math.round(pz / GRID) * GRID;
    const y = Math.round(baseY / GRID) * GRID;
    this.ghostPos.set(x, y, z);
    this.ghost.position.set(x, y + size[1] / 2, z);
    // Boîte de base portée : dims déjà orientées (R les échange) — pas de
    // rotation du mesh ; objet palette : rotation par quarts de tour.
    this.ghost.rotation.y = this.carried?.type === 'base' ? 0 : (this.rot * Math.PI) / 2;
    this.ghost.visible = true;
    this.ghostValid = true;
  }

  private rebuildGhost(): void {
    const size = this.ghostSize();
    if (!size) return;
    const [sx, sy, sz] = size;
    this.ghost.geometry.dispose();
    this.ghost.geometry = new THREE.BoxGeometry(sx, sy, sz);
    this.ghostEdges.geometry.dispose();
    this.ghostEdges.geometry = new THREE.EdgesGeometry(this.ghost.geometry);
  }

  // --------------------------------------------------------------------------
  // Ciblage (objets placés + boîtes de base)
  // --------------------------------------------------------------------------

  /** Cible la plus proche au centre de l'écran : objet placé ou boîte de base. */
  private targetAtCrosshair():
    | { type: 'custom'; objId: number; dist: number }
    | { type: 'base'; baseIdx: number; dist: number }
    | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.renderer.camera);
    this.raycaster.far = MAX_PLACE_DIST;
    let best: ReturnType<MapEditorController['targetAtCrosshair']> = null;
    const customGroup = this.mapBuilder.customObjectsGroup;
    if (customGroup) {
      const hit = this.raycaster.intersectObject(customGroup, true)[0];
      const objId = hit?.object.userData.objId as number | undefined;
      if (hit && objId !== undefined) {
        best = { type: 'custom', objId, dist: hit.distance };
      }
    }
    if (this.pickGroup) {
      const hit = this.raycaster.intersectObject(this.pickGroup, true)[0];
      const baseIdx = hit?.object.userData.baseIdx as number | undefined;
      if (hit && baseIdx !== undefined && (best === null || hit.distance < best.dist)) {
        best = { type: 'base', baseIdx, dist: hit.distance };
      }
    }
    return best;
  }

  // --------------------------------------------------------------------------
  // Actions (UI + raccourcis)
  // --------------------------------------------------------------------------

  getUIState(): EditorUIState {
    return {
      kind: this.kind,
      rot: this.rot,
      count: this.objects.length,
      baseEditCount: this.baseEdits.length,
      dirty: this.dirty,
      locked: this.locked,
      saving: this.saving,
      lastSaveOk: this.lastSaveOk,
      lastSaveError: this.lastSaveError,
      scale:
        this.carried?.type === 'base'
          ? [this.carried.dims[0], this.carried.dims[1], this.carried.dims[2]]
          : [this.scale[0], this.scale[1], this.scale[2]],
      carrying: this.carried ? this.carried.type : null,
    };
  }

  setKind(kind: string): void {
    if (!(kind in MAP_OBJECT_DEFS) && baseSizeForKind(kind, this.props) === null) return;
    if (this.carried) this.cancelCarry(); // changer de type annule le déplacement
    this.kind = kind;
    this.scale = [1, 1, 1];
    this.rebuildGhost();
    this.emit();
  }

  resetScale(): void {
    if (this.carried?.type === 'base') return; // dims libres : pas de « 1:1 »
    this.scale = [1, 1, 1];
    this.rebuildGhost();
    this.emit();
  }

  rotate(): void {
    if (this.carried?.type === 'base') {
      // Boîte de base : rotation = échange des dimensions X/Z.
      const d = this.carried.dims;
      [d[0], d[2]] = [d[2], d[0]];
      this.rebuildGhost();
      this.emit();
      return;
    }
    this.rot = ((this.rot + 1) % 4) as 0 | 1 | 2 | 3;
    this.emit();
  }

  place(): void {
    if (!this.ghostValid) return;
    if (this.carried?.type === 'base') {
      // DÉPÔT d'une boîte de base : l'édition {idx, box} est appliquée ICI
      // (première et seule modification du déplacement).
      this.pushUndo();
      const [w, h, d] = this.carried.dims;
      const box: [number, number, number, number, number, number] = [
        Math.round((this.ghostPos.x - w / 2) * 100) / 100,
        Math.round(this.ghostPos.y * 100) / 100,
        Math.round((this.ghostPos.z - d / 2) * 100) / 100,
        Math.round((this.ghostPos.x + w / 2) * 100) / 100,
        Math.round((this.ghostPos.y + h) * 100) / 100,
        Math.round((this.ghostPos.z + d / 2) * 100) / 100,
      ];
      const idx = this.carried.idx;
      const prev = this.carried.prev;
      this.baseEdits = this.baseEdits.filter((e) => e.idx !== idx);
      this.baseEdits.push({ idx, box });
      this.carried = null;
      this.kind = prev.kind;
      this.rot = prev.rot;
      this.scale = prev.scale;
      this.dirty = true;
      console.info(`[éditeur] boîte de base #${idx} déplacée`);
      this.rebuildGhost();
      this.applyLocal();
      return;
    }
    if (this.carried?.type === 'custom') {
      // DÉPÔT d'un objet placé : mise à jour EN PLACE (id conservé).
      const obj = this.objects.find((o) => o.id === (this.carried as { id: number }).id);
      const prev = this.carried.prev;
      this.carried = null;
      if (obj) {
        this.pushUndo();
        obj.x = this.ghostPos.x;
        obj.y = this.ghostPos.y;
        obj.z = this.ghostPos.z;
        obj.rot = this.rot;
        delete obj.sx;
        delete obj.sy;
        delete obj.sz;
        if (this.scale[0] !== 1) obj.sx = this.scale[0];
        if (this.scale[1] !== 1) obj.sy = this.scale[1];
        if (this.scale[2] !== 1) obj.sz = this.scale[2];
        this.dirty = true;
        console.info(`[éditeur] objet #${obj.id} déplacé`);
      }
      this.kind = prev.kind;
      this.rot = prev.rot;
      this.scale = prev.scale;
      this.rebuildGhost();
      this.applyLocal();
      return;
    }
    // Placement d'un nouvel objet de palette.
    if (this.objects.length >= MAX_PLACED_OBJECTS) return;
    this.pushUndo();
    const o: PlacedObject = {
      id: this.nextId++,
      kind: this.kind,
      x: this.ghostPos.x,
      y: this.ghostPos.y,
      z: this.ghostPos.z,
      rot: this.rot,
    };
    if (this.scale[0] !== 1) o.sx = this.scale[0];
    if (this.scale[1] !== 1) o.sy = this.scale[1];
    if (this.scale[2] !== 1) o.sz = this.scale[2];
    this.objects.push(o);
    this.dirty = true;
    this.applyLocal();
  }

  /** Saisit l'objet visé (clic droit / E) : objet placé OU boîte de la map de
   *  base. L'objet RESTE AFFICHÉ à sa place (contour) — le fantôme montre la
   *  destination ; RIEN n'est modifié avant le dépôt (clic gauche).
   *  Clic droit / E / Ctrl+Z pendant le port = annulation sans effet. */
  grabTargeted(): void {
    if (this.carried) return;
    const target = this.targetAtCrosshair();
    if (!target) return;
    const prev: PaletteState = {
      kind: this.kind,
      rot: this.rot,
      scale: [this.scale[0], this.scale[1], this.scale[2]],
    };
    if (target.type === 'custom') {
      const obj = this.objects.find((o) => o.id === target.objId);
      if (!obj) return;
      this.carried = { type: 'custom', id: obj.id, prev };
      // Le fantôme prend l'identité de l'objet saisi (l'objet reste en place).
      this.kind = obj.kind;
      this.rot = obj.rot;
      this.scale = [obj.sx ?? 1, obj.sy ?? 1, obj.sz ?? 1];
      console.info(`[éditeur] objet saisi #${obj.id} (${obj.kind}) — clic gauche : déposer, clic droit : annuler`);
    } else {
      // Boîte de base : dimensions actuelles (après éditions précédentes).
      const boxes = editedBaseBoxes(this.baseEdits);
      const indices = editedBaseIndices(this.baseEdits);
      const at = indices.indexOf(target.baseIdx);
      if (at < 0) return;
      const b = boxes[at];
      this.carried = {
        type: 'base',
        idx: target.baseIdx,
        dims: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z],
        prev,
      };
      console.info(`[éditeur] boîte de base saisie #${target.baseIdx} — clic gauche : déposer, clic droit : annuler`);
    }
    this.rebuildGhost();
    this.emit();
  }

  /** Annule la saisie en cours — AUCUNE modification n'a eu lieu. */
  cancelCarry(): void {
    if (!this.carried) return;
    const prev = this.carried.prev;
    this.carried = null;
    this.kind = prev.kind;
    this.rot = prev.rot;
    this.scale = prev.scale;
    this.rebuildGhost();
    this.emit();
  }

  /** Supprime l'objet visé au centre de l'écran (placé OU map de base). */
  deleteTargeted(): void {
    if (this.carried) return; // pendant un déplacement : clic droit ignoré
    const target = this.targetAtCrosshair();
    if (!target) return;
    this.pushUndo();
    if (target.type === 'custom') {
      this.objects = this.objects.filter((o) => o.id !== target.objId);
    } else {
      this.baseEdits = this.baseEdits.filter((e) => e.idx !== target.baseIdx);
      this.baseEdits.push({ idx: target.baseIdx, remove: true });
    }
    this.dirty = true;
    this.applyLocal();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.objects = prev.objects;
    this.baseEdits = prev.baseEdits;
    this.dirty = true;
    this.applyLocal();
  }

  /** Efface les objets PLACÉS et restaure toutes les boîtes de base. */
  clearAll(): void {
    if (this.carried) this.cancelCarry();
    if (this.objects.length === 0 && this.baseEdits.length === 0) return;
    this.pushUndo();
    this.objects = [];
    this.baseEdits = [];
    this.dirty = true;
    this.applyLocal();
  }

  /** Sauvegarde serveur : persiste, applique les collisions, rediffuse. */
  async save(): Promise<void> {
    if (this.saving) return;
    if (this.carried) this.cancelCarry(); // un objet porté n'est pas perdu
    this.saving = true;
    this.emit();
    try {
      // La sauvegarde du salon principal est réservée à l'admin : le code
      // saisi dans l'écran ADMIN (localStorage) est joint à la requête.
      const adminToken = localStorage.getItem('strike-admin-token') ?? '';
      const res = await fetch('/mapedit/objects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({ objects: this.objects, baseEdits: this.baseEdits, weaponMods: this.weaponMods, loadouts: this.loadouts, props: this.props, baseTerrain: this.baseTerrain }),
      });
      this.lastSaveOk = res.ok;
      this.lastSaveError = res.ok
        ? null
        : res.status === 401
          ? 'CODE ADMIN REQUIS — entrez-le dans le menu ADMIN (votre map reste publiable dans la communauté)'
          : null;
      if (res.ok) this.dirty = false;
    } catch {
      this.lastSaveOk = false;
      this.lastSaveError = null;
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  // --------------------------------------------------------------------------
  // Armurerie (mods d'armes)
  // --------------------------------------------------------------------------

  /** Groupe d'aperçu de l'arme (flotte devant la caméra de l'éditeur). */
  private previewGroup: THREE.Group | null = null;
  private previewId: WeaponId | null = null;
  private previewSeq = 0;

  /** Modifie une stat (undefined = retour à la valeur d'origine). */
  setWeaponStat(id: WeaponId, key: keyof WeaponStatsMod, value: number | boolean | string | undefined): void {
    const entry = this.weaponMods[id] ?? {};
    const stats: WeaponStatsMod = { ...(entry.stats ?? {}) };
    if (value === undefined) {
      delete stats[key];
    } else {
      (stats as Record<string, number | boolean | string>)[key] = value;
    }
    entry.stats = Object.keys(stats).length > 0 ? stats : undefined;
    if (entry.stats || entry.model) this.weaponMods[id] = entry;
    else delete this.weaponMods[id];
    this.dirty = true;
    this.emit();
  }

  /** Définit / retire le modèle 3D custom d'une arme, et met à jour l'aperçu. */
  setWeaponModel(id: WeaponId, model: WeaponModelMod | null): void {
    const entry = this.weaponMods[id] ?? {};
    entry.model = model ?? undefined;
    if (entry.stats || entry.model) this.weaponMods[id] = entry;
    else delete this.weaponMods[id];
    this.dirty = true;
    if (this.previewId === id) void this.showPreview(id);
    this.emit();
  }

  /** Change le terrain de départ (map de base / terrain vide). */
  setTerrain(t: BaseTerrain): void {
    if (t === this.baseTerrain) return;
    this.pushUndo();
    this.baseTerrain = t;
    this.dirty = true;
    this.applyLocal();
  }

  /** Ajoute ou met à jour un prop custom du pack. Retourne son id, ou null. */
  upsertProp(def: Omit<CustomPropDef, 'id'> & { id?: string }): string | null {
    if (def.id) {
      const at = this.props.findIndex((p) => p.id === def.id);
      if (at >= 0) {
        this.props[at] = { ...(def as CustomPropDef) };
        this.dirty = true;
        this.applyLocal();
        return def.id;
      }
    }
    if (this.props.length >= MAX_CUSTOM_PROPS) return null;
    let n = 1;
    while (this.props.some((p) => p.id === `p${n}`)) n++;
    const id = `p${n}`;
    this.props.push({ ...(def as CustomPropDef), id });
    this.dirty = true;
    this.applyLocal();
    return id;
  }

  /** Retire un prop du pack (les objets placés de ce prop sont supprimés). */
  removeProp(id: string): void {
    this.pushUndo();
    this.props = this.props.filter((p) => p.id !== id);
    this.objects = this.objects.filter((o) => o.kind !== `prop:${id}`);
    if (this.kind === `prop:${id}`) this.kind = 'crate';
    this.dirty = true;
    this.rebuildGhost();
    this.applyLocal();
  }

  /** Assigne un loadout à une classe (null = loadout d'origine). */
  setClassLoadout(classId: ClassId, pair: [WeaponId, WeaponId] | null): void {
    if (pair === null) delete this.loadouts[classId];
    else this.loadouts[classId] = pair;
    this.dirty = true;
    this.emit();
  }

  /** Upload d'un modèle 3D. Retourne {file} ou {error} (message serveur). */
  async uploadModel(fileData: ArrayBuffer): Promise<{ file?: string; error?: string }> {
    return this.uploadTo('/mods/models', fileData);
  }

  /** Upload d'une texture (PNG/JPG/WebP). Retourne {file} ou {error}. */
  async uploadTexture(fileData: ArrayBuffer): Promise<{ file?: string; error?: string }> {
    return this.uploadTo('/mods/textures', fileData);
  }

  private async uploadTo(url: string, fileData: ArrayBuffer): Promise<{ file?: string; error?: string }> {
    try {
      const res = await fetch(url, { method: 'POST', body: fileData });
      let data: { ok?: boolean; file?: string; error?: string } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        /* corps non-JSON (413 texte) : message générique par statut */
      }
      if (res.ok && data.ok && data.file) return { file: data.file };
      return {
        error:
          data.error ??
          (res.status === 413 ? 'fichier trop volumineux' : `échec de l'upload (HTTP ${res.status})`),
      };
    } catch {
      return { error: 'serveur injoignable' };
    }
  }

  /** Affiche l'aperçu 3D d'une arme avec sa calibration COURANTE (les modèles
   *  custom passent par le cache de WeaponModels, purgé à chaque changement). */
  async showPreview(id: WeaponId): Promise<void> {
    this.previewId = id;
    const seq = ++this.previewSeq;
    setWeaponModelMods(this.weaponMods); // calibration live -> cache purgé si changée
    const n = await loadWeaponModel(id);
    if (seq !== this.previewSeq || this.previewId !== id) return;
    this.closePreviewGroup();
    const g = new THREE.Group();
    if (n) {
      g.add(n.root); // instance partagée — JAMAIS disposée, retirée au close
      // Ligne de visée (bleue) au niveau adsY, le long du canon.
      const sight = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, n.adsY, 0.35),
          new THREE.Vector3(0, n.adsY, -n.length * 0.75),
        ]),
        new THREE.LineBasicMaterial({ color: '#58A6E8' }),
      );
      g.add(sight);
      // Bouche du canon (sphère ambre).
      const muzzle = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 10, 10),
        new THREE.MeshBasicMaterial({ color: '#F59E1F' }),
      );
      muzzle.position.copy(n.muzzle.position);
      g.add(muzzle);
    }
    this.previewGroup = g;
    this.renderer.scene.add(g);
    this.emit();
  }

  closePreview(): void {
    this.previewId = null;
    this.previewSeq++;
    this.closePreviewGroup();
    this.emit();
  }

  private closePreviewGroup(): void {
    if (!this.previewGroup) return;
    this.renderer.scene.remove(this.previewGroup);
    // Les enfants « marqueurs » sont à nous ; le root d'arme est partagé.
    for (const child of [...this.previewGroup.children]) {
      if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
        (child as THREE.Mesh).geometry?.dispose();
      }
    }
    this.previewGroup = null;
  }

  /** Vrai si l'aperçu est ouvert (pour l'UI). */
  get previewOpen(): WeaponId | null {
    return this.previewId;
  }

  /** Publie l'état courant dans la bibliothèque de la communauté.
   *  Retourne le slug attribué, ou null en cas d'échec. */
  async publish(name: string, author: string): Promise<{ slug: string; name: string } | null> {
    if (this.carried) this.cancelCarry();
    try {
      const res = await fetch('/mapedit/maps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          author,
          objects: this.objects,
          baseEdits: this.baseEdits,
          weaponMods: this.weaponMods,
          loadouts: this.loadouts,
          props: this.props,
          baseTerrain: this.baseTerrain,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { ok?: boolean; slug?: string; name?: string };
      return data.ok && data.slug ? { slug: data.slug, name: data.name ?? name } : null;
    } catch {
      return null;
    }
  }

  private pushUndo(): void {
    this.undoStack.push({
      objects: this.objects.map((o) => ({ ...o })),
      baseEdits: this.baseEdits.map((e) => ({ ...e, box: e.box ? [...e.box] as MapBaseEdit['box'] : undefined })),
    });
    if (this.undoStack.length > 60) this.undoStack.shift();
  }

  private emit(): void {
    this.onChange?.();
  }
}
