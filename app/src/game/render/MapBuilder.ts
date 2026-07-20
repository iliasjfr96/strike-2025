// ============================================================================
// STRIKE 2025 — MapBuilder.ts « KESTREL YARD »
// Construit le rendu de KESTREL YARD depuis MAP_BOXES (shared/map.ts) avec de
// VRAIES textures PBR (packs CC0 Poly Haven, public/textures/kestrel : albedo
// + normale + ARM AO/rough/metal) :
//  - containers : texture photo container_side teintée par couleur ;
//  - hangar : tôle ondulée worn_corrugated_iron ; bâtiments bleus :
//    blue_metal_plate ; usine est : factory_wall ; béton : concrete ;
//  - sol : concrete_floor + marquages ; voies : ballast gravel + traverses
//    bois + rails acier ; passerelles : metal_grate_rusty + garde-corps jaunes ;
//  - tour avec antenne parabolique, canal avec eau et culverts, grillages
//    chain-link (alpha procédural), camion, poste de garde.
// Budget : géométries fusionnées par matériau (< ~80 draw calls), ≤ 5 lights.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CANAL,
  EAST_BUILDING,
  HANGAR,
  LAMP_POSTS,
  MAP_BOXES,
  RAIL_LINES,
  TEAM_FLAGS,
  TOWER,
} from '../../shared/map';
import type { MapBox, TexKey } from '../../shared/map';
import { TEAM_SPECTRE } from '../../shared/protocol';
import type { CustomPropDef, PlacedObject } from '../../shared/protocol';
import { MAP_OBJECT_DEFS, scaledSize } from '../../shared/mapObjects';
import { instantiateProp, loadPropTemplate } from './PropModels';

const COLOR_SPECTRE = '#58A6E8';
const COLOR_RAVAGE = '#F07F13';
const COLOR_AMBER = '#F59E1F';
const TEX_BASE = './textures/kestrel';

/** Table texture -> id de fichier. */
const TEX_ID: Record<Exclude<TexKey, 'none' | 'container'>, string> = {
  corrugated: 'worn_corrugated_iron',
  'blue-metal': 'blue_metal_plate',
  factory: 'factory_wall',
  concrete: 'concrete',
  grate: 'metal_grate_rusty',
  asphalt: 'asphalt_floor',
  'concrete-floor': 'concrete_floor',
  gravel: 'gravel_floor_02',
  wood: 'brown_planks_03',
  shutter: 'painted_metal_shutter',
  rust: 'rusty_metal',
};

// ----------------------------------------------------------------------------
// Chargement PBR
// ----------------------------------------------------------------------------

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, { map: THREE.Texture; normalMap: THREE.Texture; armMap: THREE.Texture }>();

function loadPbr(id: string): { map: THREE.Texture; normalMap: THREE.Texture; armMap: THREE.Texture } {
  let entry = texCache.get(id);
  if (!entry) {
    const load = (suffix: string): THREE.Texture => {
      const rel = `${TEX_BASE}/${id}_${suffix}_1k.jpg`;
      return texLoader.load(
        rel,
        undefined,
        undefined,
        () => console.warn(`[textures] échec de chargement : ${rel} (URL complète: ${new URL(rel, location.href).href})`),
      );
    };
    const map = load('diff');
    map.colorSpace = THREE.SRGBColorSpace;
    const normalMap = load('nor_gl');
    const armMap = load('arm');
    for (const t of [map, normalMap, armMap]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
    }
    entry = { map, normalMap, armMap };
    texCache.set(id, entry);
  }
  return entry;
}

/** Matériau PBR standard d'une texture Poly Haven (ARM = AO/rough/metal). */
function pbrMaterial(
  id: string,
  opts: { color?: string; envIntensity?: number } = {},
): THREE.MeshStandardMaterial {
  const pbr = loadPbr(id);
  return new THREE.MeshStandardMaterial({
    map: pbr.map,
    normalMap: pbr.normalMap,
    aoMap: pbr.armMap,
    roughnessMap: pbr.armMap,
    metalnessMap: pbr.armMap,
    color: opts.color !== undefined ? new THREE.Color(opts.color) : new THREE.Color('#ffffff'),
    envMapIntensity: opts.envIntensity ?? 0.55,
  });
}

/** UV monde projetées par boîte (densité constante) sur géométrie fusionnée. */
function applyWorldUV(geom: THREE.BufferGeometry, scale: number): void {
  const pos = geom.getAttribute('position');
  const nor = geom.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = x / scale;
      v = z / scale;
    } else if (nx >= nz) {
      u = z / scale;
      v = y / scale;
    } else {
      u = x / scale;
      v = y / scale;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Texture chain-link procédurale (fils diagonaux + alpha). */
function makeChainLinkTexture(): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(170,178,184,0.95)';
  ctx.lineWidth = 2.4;
  const step = 16;
  for (let x = -s; x < s * 2; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + s, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + s, 0);
    ctx.lineTo(x, s);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Dégradé radial pour les halos lumineux. */
function makeGlowTexture(): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,210,140,0.85)');
  g.addColorStop(0.35, 'rgba(245,180,80,0.26)');
  g.addColorStop(1, 'rgba(245,158,31,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ----------------------------------------------------------------------------
// MapBuilder
// ----------------------------------------------------------------------------

export class MapBuilder {
  readonly group = new THREE.Group();
  private beaconMat: THREE.MeshBasicMaterial | null = null;
  private waterMat: THREE.MeshStandardMaterial | null = null;
  private readonly glowTex: THREE.CanvasTexture;

  /** Décorations propres à KESTREL YARD (rails, tour, canal, camion…) —
   *  masquées en terrain vide ('flat'). */
  private readonly decorGroup = new THREE.Group();

  constructor() {
    this.group.name = 'map';
    this.glowTex = makeGlowTexture();
    this.buildBoxes();
    this.buildGround();
    // Tout ce qui suit est décoratif et spécifique à la map de base : capturé
    // dans decorGroup pour pouvoir être masqué en mode « terrain vide ».
    const before = new Set(this.group.children);
    this.buildRails();
    this.buildHangarDetails();
    this.buildTower();
    this.buildCatwalks();
    this.buildEastBuildingDetails();
    this.buildCanal();
    this.buildFences();
    this.buildTruck();
    this.buildGateDetails();
    this.buildLamps();
    this.buildTeamFlags();
    this.decorGroup.name = 'kestrel-decor';
    for (const child of [...this.group.children]) {
      if (!before.has(child)) {
        this.group.remove(child);
        this.decorGroup.add(child);
      }
    }
    this.group.add(this.decorGroup);
  }

  /** Terrain de départ : masque les décorations Kestrel en mode 'flat'. */
  setTerrain(terrain: 'kestrel' | 'flat'): void {
    this.decorGroup.visible = terrain !== 'flat';
  }

  /** Boxes de map : matériau PBR selon MapBox.tex (fusion par tex|color|uv). */
  /** Groupe des boîtes de base (reconstruit quand la map est éditée). */
  private baseBoxGroup: THREE.Group | null = null;
  /** Cache des matériaux des boîtes de base (réutilisés entre reconstructions). */
  private readonly baseBoxMats = new Map<string, THREE.MeshStandardMaterial>();

  private buildBoxes(list?: readonly MapBox[]): void {
    // Reconstruction : retire l'ancien groupe (géométries disposées,
    // matériaux conservés — cache).
    if (this.baseBoxGroup) {
      this.group.remove(this.baseBoxGroup);
      this.baseBoxGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    const target = new THREE.Group();
    target.name = 'base-boxes';

    interface Group {
      tex: TexKey;
      color?: string;
      uvScale: number;
      geoms: THREE.BoxGeometry[];
    }
    const groups = new Map<string, Group>();
    for (const b of list ?? MAP_BOXES) {
      const tex = b.tex ?? 'none';
      const uv = b.uvScale ?? 4;
      const key = `${tex}|${b.color ?? ''}|${uv}`;
      let g = groups.get(key);
      if (!g) {
        g = { tex, color: b.color, uvScale: uv, geoms: [] };
        groups.set(key, g);
      }
      const sx = b.max.x - b.min.x;
      const sy = b.max.y - b.min.y;
      const sz = b.max.z - b.min.z;
      const geom = new THREE.BoxGeometry(sx, sy, sz);
      geom.translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      g.geoms.push(geom);
    }

    for (const [key, g] of groups) {
      const merged = mergeGeometries(g.geoms, false);
      for (const geom of g.geoms) geom.dispose();
      if (!merged) continue;
      if (g.tex !== 'container' && g.tex !== 'none') {
        applyWorldUV(merged, g.uvScale);
      }
      let material = this.baseBoxMats.get(key);
      if (!material) {
        if (g.tex === 'container') {
          // container_side : UV boîte standard (texture dessinée pour une face).
          material = pbrMaterial('container_side', { color: g.color ?? '#ffffff', envIntensity: 0.7 });
        } else if (g.tex === 'none') {
          material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(g.color ?? '#7d838a'),
            roughness: 0.8,
            metalness: 0.2,
            envMapIntensity: 0.45,
          });
        } else {
          material = pbrMaterial(TEX_ID[g.tex], { color: g.color });
        }
        this.baseBoxMats.set(key, material);
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      target.add(mesh);
    }
    this.baseBoxGroup = target;
    this.group.add(target);
  }

  /** Reconstruit les boîtes de base depuis une liste ÉDITÉE (éditeur de map). */
  setBaseBoxes(list: readonly MapBox[]): void {
    this.buildBoxes(list);
  }

  /** Sol de la cour : dalle béton (concrete_floor) + marquages jaunes. */
  private buildGround(): void {
    const mat = pbrMaterial('concrete_floor', { color: '#78828c', envIntensity: 0.4 });
    const geo = new THREE.PlaneGeometry(86, 108);
    geo.rotateX(-Math.PI / 2);
    applyWorldUV(geo, 7);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.set(1.5, 0, 0);
    this.group.add(mesh);

    // Marquages jaunes délavés (lignes de guidage au sol, voir image).
    const lineMat = new THREE.MeshBasicMaterial({ color: '#8f7526' });
    for (const x of [-10, 10]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 92), lineMat);
      line.position.set(x, 0.012, 0);
      this.group.add(line);
    }
    // Croisillons devant le hangar.
    const crossMat = new THREE.MeshBasicMaterial({ color: '#7d6722' });
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 8), crossMat);
      c.position.set(-26 + i * 2.2, 0.012, -34.5);
      c.rotation.y = Math.PI / 5;
      this.group.add(c);
    }
  }

  /** Voies ferrées : ballast (gravel) + traverses bois + rails acier. */
  private buildRails(): void {
    const ballastMat = pbrMaterial('gravel_floor_02', { color: '#b9b4ac', envIntensity: 0.35 });
    const sleeperMat = pbrMaterial('brown_planks_03', { color: '#4a3b2c', envIntensity: 0.2 });
    const railMat = new THREE.MeshStandardMaterial({
      color: '#6f767e',
      roughness: 0.28,
      metalness: 0.9,
      envMapIntensity: 1.1,
    });

    const ballastGeoms: THREE.BoxGeometry[] = [];
    const sleeperGeoms: THREE.BoxGeometry[] = [];
    const railGeoms: THREE.BoxGeometry[] = [];
    for (const x of RAIL_LINES) {
      const bed = new THREE.BoxGeometry(2.4, 0.08, 88);
      bed.translate(x, 0.04, -2);
      ballastGeoms.push(bed);
      for (let z = -44; z < 40; z += 0.7) {
        const sl = new THREE.BoxGeometry(1.9, 0.07, 0.26);
        sl.translate(x, 0.1, z);
        sleeperGeoms.push(sl);
      }
      for (const dx of [-0.72, 0.72]) {
        const r = new THREE.BoxGeometry(0.09, 0.14, 88);
        r.translate(x + dx, 0.17, -2);
        railGeoms.push(r);
      }
    }
    const addMerged = (geoms: THREE.BoxGeometry[], mat: THREE.MeshStandardMaterial, uv?: number): void => {
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) return;
      if (uv !== undefined) applyWorldUV(merged, uv);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    addMerged(ballastGeoms, ballastMat, 2.4);
    addMerged(sleeperGeoms, sleeperMat, 1.2);
    addMerged(railGeoms, railMat);
  }

  /** Hangar : encadrements de portes jaunes, verrières, quais de dock. */
  private buildHangarDetails(): void {
    const H = HANGAR;
    const yellowMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.55, metalness: 0.35, envMapIntensity: 0.5 });
    // Poteaux jaunes aux ouvertures nord (x -24/-20/-16/-12) et sud (x -18/-14).
    const postGeo = new THREE.BoxGeometry(0.28, 4.6, 0.28);
    const posts: [number, number][] = [
      [-24, H.z0], [-20, H.z0], [-16, H.z0], [-12, H.z0], [-18, H.z1], [-14, H.z1],
    ];
    for (const [x, z] of posts) {
      const p = new THREE.Mesh(postGeo, yellowMat);
      p.position.set(x, 2.3, z);
      p.castShadow = true;
      this.group.add(p);
    }
    // Verrières (bandeaux translucides sur le toit).
    const skyMat = new THREE.MeshBasicMaterial({ color: '#8fa8b8', transparent: true, opacity: 0.35 });
    for (const x of [-26, -21, -16]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(3, 0.06, H.z1 - H.z0 - 4), skyMat);
      s.position.set(x, H.h + 0.5, 0);
      this.group.add(s);
    }
    // Rideaux de dock à moitié ouverts (painted_metal_shutter).
    const shutterMat = pbrMaterial('painted_metal_shutter', { color: '#8d9297' });
    for (const z of [-23.3, -5.5, 10.3]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 3.3), shutterMat);
      door.position.set(H.x1 + 0.05, 4.3 - 1.1, z);
      this.group.add(door);
    }
  }

  /** Tour de contrôle : cabine vitrée, garde-corps, antenne parabolique. */
  private buildTower(): void {
    const T = TOWER;
    // Bandeau vitré de la cabine (verre sombre émissif léger).
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#1a2830',
      emissive: new THREE.Color('#3a5868'),
      emissiveIntensity: 0.3,
      roughness: 0.15,
      metalness: 0.6,
    });
    const band = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.2, 5.8), glassMat);
    band.position.set(T.x, T.baseH + 1.0, T.z);
    this.group.add(band);
    // Garde-corps jaune autour de la cabine.
    const railMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.5, metalness: 0.4 });
    for (const [dx, dz, w, d] of [
      [0, -3.1, 6.4, 0.08],
      [0, 3.1, 6.4, 0.08],
      [-3.1, 0, 0.08, 6.4],
      [3.1, 0, 0.08, 6.4],
    ] as const) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), railMat);
      r.position.set(T.x + dx, T.baseH + 2.2, T.z + dz);
      this.group.add(r);
    }
    // Antenne parabolique (sphère partielle orientée) + mât.
    const dishMat = new THREE.MeshStandardMaterial({ color: '#b9bec2', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide, envMapIntensity: 0.7 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 10), railMat);
    mast.position.set(T.x, T.baseH + T.cabH + 1.0, T.z);
    this.group.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3.2), dishMat);
    dish.position.set(T.x, T.baseH + T.cabH + 2.4, T.z);
    dish.rotation.x = -Math.PI / 2.6;
    dish.rotation.z = Math.PI / 8;
    this.group.add(dish);
    // Gyrophare.
    this.beaconMat = new THREE.MeshBasicMaterial({ color: COLOR_AMBER });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.beaconMat);
    beacon.position.set(T.x, T.baseH + T.cabH + 3.5, T.z);
    this.group.add(beacon);
  }

  /** Passerelles : garde-corps jaunes + poteaux de soutien. */
  private buildCatwalks(): void {
    const railMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.5, metalness: 0.4, envMapIntensity: 0.5 });
    const railGeoms: THREE.BoxGeometry[] = [];
    // Garde-corps des deux ponts (z -6.5 et z -1.5), côtés extérieurs.
    for (const zc of [-6.5, -1.5]) {
      for (const dz of [-0.45, 0.45]) {
        const top = new THREE.BoxGeometry(26.8, 0.06, 0.06);
        top.translate(0, 5.12 + 1.0, zc + dz);
        railGeoms.push(top);
        const mid = new THREE.BoxGeometry(26.8, 0.05, 0.05);
        mid.translate(0, 5.12 + 0.55, zc + dz);
        railGeoms.push(mid);
        for (let x = -13; x <= 13.5; x += 2.65) {
          const post = new THREE.BoxGeometry(0.06, 1.0, 0.06);
          post.translate(x, 5.12 + 0.5, zc + dz);
          railGeoms.push(post);
        }
      }
    }
    const merged = mergeGeometries(railGeoms, false);
    for (const g of railGeoms) g.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, railMat);
      mesh.castShadow = true;
      this.group.add(mesh);
    }
    // Poteaux de soutien sous les ponts (au droit des voies).
    const supportMat = pbrMaterial('rusty_metal', { color: '#6b5a4a' });
    for (const x of [-8, 8]) {
      for (const zc of [-6.5, -1.5]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.9, 0.3), supportMat);
        s.position.set(x, 2.45, zc);
        s.castShadow = true;
        this.group.add(s);
      }
    }
  }

  /** Bâtiment est : fenêtres sombres, arches (demi-tore), tuyaux, AC toit. */
  private buildEastBuildingDetails(): void {
    const B = EAST_BUILDING;
    // Bandes de fenêtres sombres sur la face ouest.
    const winMat = new THREE.MeshStandardMaterial({ color: '#141c22', roughness: 0.2, metalness: 0.5, emissive: new THREE.Color('#24333d'), emissiveIntensity: 0.2 });
    for (const z of [-14, -9, 2]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 2.4), winMat);
      w.position.set(B.x0 - 0.02, 4.2, z);
      this.group.add(w);
    }
    // Arches côté canal : demi-tores béton au-dessus des 3 ouvertures.
    const archMat = pbrMaterial('concrete', { color: '#9aa0a4' });
    for (const z of [-11.7, -3, 3.7]) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.18, 8, 18, Math.PI), archMat);
      arc.position.set(B.x1 + 0.1, 3.0, z);
      arc.rotation.y = Math.PI / 2;
      this.group.add(arc);
    }
    // Tuyauterie sur la face ouest.
    const pipeMat = pbrMaterial('rusty_metal', { color: '#7a6a55' });
    for (const z of [-16, 4.5]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5.4, 8), pipeMat);
      pipe.position.set(B.x0 - 0.15, 2.7, z);
      this.group.add(pipe);
    }
    // Unités AC sur le toit.
    const acMat = pbrMaterial('metal_grate_rusty', { color: '#8a9094' });
    for (const [x, z] of [[18, -12], [24, -4], [20, 2]] as const) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.2), acMat);
      ac.position.set(x, B.h + 0.6, z);
      ac.castShadow = true;
      this.group.add(ac);
    }
  }

  /** Canal : eau, écume, culverts sud, garde-corps du quai, bandes danger. */
  private buildCanal(): void {
    const C = CANAL;
    // Eau du canal (plan animé).
    const waterTex = makeWaterTexture();
    this.waterMat = new THREE.MeshStandardMaterial({
      map: waterTex,
      color: '#4a6474',
      roughness: 0.16,
      metalness: 0.75,
      envMapIntensity: 0.9,
    });
    const w = C.waterX1 - C.waterX0;
    const l = C.z1 - C.z0;
    const geo = new THREE.PlaneGeometry(w, l);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.waterMat);
    mesh.position.set((C.waterX0 + C.waterX1) / 2, C.waterY, (C.z0 + C.z1) / 2);
    this.group.add(mesh);
    // Écume le long des parois.
    const foamMat = new THREE.MeshBasicMaterial({ color: '#9fb8c2', transparent: true, opacity: 0.3 });
    for (const x of [C.waterX0 + 0.25, C.waterX1 - 0.25]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.5, l), foamMat);
      f.rotateX(-Math.PI / 2);
      f.position.set(x, C.waterY + 0.03, (C.z0 + C.z1) / 2);
      this.group.add(f);
    }
    // Culverts sud (2 grands tuyaux sombres vers la mer).
    const pipeMat = new THREE.MeshStandardMaterial({ color: '#20262c', roughness: 0.8, metalness: 0.3 });
    for (const x of [C.waterX0 + 1.1, C.waterX1 - 1.1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.2, 16, 1, true), pipeMat);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, C.waterY + 0.4, C.z1 - 0.5);
      this.group.add(p);
    }
    // Garde-corps du quai (poteaux + double lisse).
    const railMat = pbrMaterial('rusty_metal', { color: '#5a626a' });
    const railGeoms: THREE.BoxGeometry[] = [];
    for (let z = C.z0 + 1; z < C.z1; z += 2.4) {
      const post = new THREE.BoxGeometry(0.06, 1.05, 0.06);
      post.translate(C.quayX1 + 0.18, 0.52, z);
      railGeoms.push(post);
    }
    for (const y of [0.6, 1.05]) {
      const bar = new THREE.BoxGeometry(0.05, 0.05, C.z1 - C.z0 - 1);
      bar.translate(C.quayX1 + 0.18, y, (C.z0 + C.z1) / 2);
      railGeoms.push(bar);
    }
    const merged = mergeGeometries(railGeoms, false);
    for (const g of railGeoms) g.dispose();
    if (merged) this.group.add(new THREE.Mesh(merged, railMat));
    // Bandes danger jaune/noir sur le bord du quai.
    const hz = makeHazardTexture();
    const hzMat = new THREE.MeshBasicMaterial({ map: hz });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, C.z1 - C.z0 - 1), hzMat);
    strip.position.set(C.quayX1 - 0.15, 0.015, (C.z0 + C.z1) / 2);
    this.group.add(strip);
  }

  /** Grillages chain-link (alpha) sur l'ouest + portions nord/sud. */
  private buildFences(): void {
    const tex = makeChainLinkTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
      color: '#b9c2c9',
    });
    const segments: [number, number, number, number, number][] = [
      // [x0, z0, x1, z1, h]
      [-31.9, -46, -31.9, -20, 2.2], // ouest nord
      [-31.9, 20, -31.9, 46, 2.2], // ouest sud
      [-20, -47.9, 10, -47.9, 2.2], // nord
      [-30, 47.9, -5, 47.9, 2.2], // sud-ouest
    ];
    for (const [x0, z0, x1, z1, h] of segments) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const geo = new THREE.PlaneGeometry(len, h);
      const mesh = new THREE.Mesh(geo, mat.clone());
      (mesh.material as THREE.MeshBasicMaterial).map = tex.clone();
      (mesh.material as THREE.MeshBasicMaterial).map!.repeat.set(len / 2, h / 2);
      mesh.position.set((x0 + x1) / 2, h / 2 + 1.2, (z0 + z1) / 2);
      mesh.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
      this.group.add(mesh);
    }
  }

  /** Camion dans la cour ouest (cabine + remorque). */
  private buildTruck(): void {
    const cabMat = new THREE.MeshStandardMaterial({ color: '#c7cdd2', roughness: 0.5, metalness: 0.3, envMapIntensity: 0.6 });
    const trailerMat = pbrMaterial('container_side', { color: '#9aa2a8' });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1c2024', roughness: 0.8, metalness: 0.2 });
    const truck = new THREE.Group();
    const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.6, 6.5), trailerMat);
    trailer.position.y = 1.7;
    trailer.castShadow = true;
    truck.add(trailer);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.2), cabMat);
    cab.position.set(0, 1.4, 4.3);
    cab.castShadow = true;
    truck.add(cab);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.1), darkMat);
    windshield.position.set(0, 1.9, 5.35);
    truck.add(windshield);
    for (const [x, z] of [[-1.1, -2], [1.1, -2], [-1.1, 2], [1.1, 2], [-1.1, 4.3], [1.1, 4.3]] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12), darkMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.5, z);
      truck.add(wheel);
    }
    truck.position.set(-17, 0, 26);
    truck.rotation.y = -0.35;
    this.group.add(truck);
  }

  /** Poste de garde : fenêtre + barrière jaune/blanche. */
  private buildGateDetails(): void {
    const winMat = new THREE.MeshStandardMaterial({ color: '#141c22', roughness: 0.2, metalness: 0.5, emissive: new THREE.Color('#2a3a46'), emissiveIntensity: 0.25 });
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.08), winMat);
    win.position.set(8, 1.9, 39.8);
    this.group.add(win);
    // Barrière de portail (rayée, abaissée).
    const hz = makeHazardTexture();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.14, 0.14), new THREE.MeshBasicMaterial({ map: hz }));
    arm.position.set(4.5, 1.0, 40.0);
    this.group.add(arm);
    const pivot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.5, metalness: 0.4 }));
    pivot.position.set(11.5, 0.6, 40.0);
    this.group.add(pivot);
  }

  /** Lampadaires : sphère émissive + halo ; ≤ 5 vraies PointLight. */
  private buildLamps(): void {
    const lampGlowMat = new THREE.MeshBasicMaterial({ color: '#FFD9A0' });
    const sphereGeo = new THREE.SphereGeometry(0.15, 10, 8);
    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 0.7);
    const armMat = pbrMaterial('rusty_metal', { color: '#3a3f44' });
    // Lampes avec vraie lumière : 2 hangar, 1 bâtiment est, 2 extérieurs centraux.
    const lit = new Set([2, 5, 9, 10, 11]);
    LAMP_POSTS.forEach((lamp, i) => {
      const head = new THREE.Mesh(sphereGeo, lampGlowMat);
      head.position.set(lamp.x, lamp.height + 0.02, lamp.z);
      this.group.add(head);
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(lamp.x, lamp.height - 0.1, lamp.z);
      this.group.add(arm);
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 }),
      );
      halo.scale.set(3, 3, 1);
      halo.position.set(lamp.x, lamp.height, lamp.z);
      this.group.add(halo);
      const pool = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.35 }),
      );
      pool.scale.set(6.5, 3, 1);
      pool.position.set(lamp.x, 0.15, lamp.z);
      this.group.add(pool);
      if (lit.has(i)) {
        const light = new THREE.PointLight('#F5B95C', 18, 17, 2);
        light.position.set(lamp.x, lamp.height - 0.3, lamp.z);
        light.castShadow = false;
        this.group.add(light);
      }
    });
  }

  /** Drapeaux décoratifs de zone de spawn. */
  private buildTeamFlags(): void {
    const mastMat = pbrMaterial('rusty_metal', { color: '#43494F' });
    const teams: { x: number; z: number; color: string }[] = [
      { x: TEAM_FLAGS[TEAM_SPECTRE].x, z: TEAM_FLAGS[TEAM_SPECTRE].z, color: COLOR_SPECTRE },
      { x: TEAM_FLAGS[1].x, z: TEAM_FLAGS[1].z, color: COLOR_RAVAGE },
    ];
    for (const t of teams) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.4, 8), mastMat);
      mast.position.set(t.x, 2.2, t.z);
      mast.castShadow = true;
      this.group.add(mast);
      const bannerMat = new THREE.MeshStandardMaterial({
        color: t.color,
        emissive: new THREE.Color(t.color),
        emissiveIntensity: 0.35,
        roughness: 0.8,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 1.7), bannerMat);
      banner.position.set(t.x, 3.7, t.z + (t.x < 0 ? 0.9 : -0.9));
      this.group.add(banner);
    }
  }

  // --------------------------------------------------------------------------
  // Objets de l'éditeur de map (mode build)
  // --------------------------------------------------------------------------

  private customGroup: THREE.Group | null = null;
  private readonly customMats = new Map<string, THREE.MeshStandardMaterial>();
  /** Matériaux des props FAÇONNÉS (clé texture|couleur — partagés). */
  private readonly shapeMats = new Map<string, THREE.MeshStandardMaterial>();
  /** Matériau grillage (texture canvas chain-link, transparent). */
  private fenceMat: THREE.MeshStandardMaterial | null = null;

  /** Matériau PBR partagé d'un prop façonné. */
  private shapeMat(tex: string, color?: string): THREE.MeshStandardMaterial {
    const key = `${tex}|${color ?? ''}`;
    let m = this.shapeMats.get(key);
    if (!m) {
      m = pbrMaterial(tex, { color });
      this.shapeMats.set(key, m);
    }
    return m;
  }

  /**
   * Formes RÉELLES des props d'éditeur non parallélépipédiques (fûts, pneus,
   * cône, citerne, palettes…). Visuel uniquement : la COLLISION reste l'AABB
   * de MAP_OBJECT_DEFS (identique client/serveur). Groupe : base à y=0,
   * centré en XZ, dimensions sx/sy/sz déjà mises à l'échelle. Retourne null
   * pour les kinds naturellement « boîte » (caisse, container, mur…).
   */
  private buildShapedProp(kind: string, sx: number, sy: number, sz: number): THREE.Group | null {
    const def = MAP_OBJECT_DEFS[kind];
    if (!def) return null;
    const g = new THREE.Group();
    const mat = this.shapeMat(def.tex, def.color);
    const add = (geom: THREE.BufferGeometry, x: number, y: number, z: number, m: THREE.Material = mat, rx = 0, rz = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(geom, m);
      mesh.position.set(x, y, z);
      if (rx !== 0) mesh.rotation.x = rx;
      if (rz !== 0) mesh.rotation.z = rz;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material = mat): void => {
      const geom = new THREE.BoxGeometry(w, h, d);
      applyWorldUV(geom, 1.6);
      add(geom, x, y, z, m);
    };

    switch (kind) {
      case 'barrel_metal':
      case 'barrel_blue': {
        // Fût : cylindre + 2 anneaux de renfort.
        const r = Math.min(sx, sz) / 2;
        add(new THREE.CylinderGeometry(r * 0.96, r * 0.96, sy, 20), 0, sy / 2, 0);
        add(new THREE.CylinderGeometry(r, r, sy * 0.05, 20), 0, sy * 0.28, 0);
        add(new THREE.CylinderGeometry(r, r, sy * 0.05, 20), 0, sy * 0.72, 0);
        return g;
      }
      case 'pallet':
      case 'pallet_stack': {
        // Palette(s) : 3 chevrons + 5 lattes. Empilée : 4 niveaux.
        const levels = kind === 'pallet_stack' ? 4 : 1;
        const ph = sy / levels;
        for (let l = 0; l < levels; l++) {
          const y0 = l * ph;
          for (let i = -1; i <= 1; i++) {
            box(sx * 0.96, ph * 0.55, sz * 0.14, 0, y0 + ph * 0.275, i * sz * 0.4);
          }
          for (let i = -2; i <= 2; i++) {
            box(sx * 0.16, ph * 0.3, sz * 0.98, i * sx * 0.21, y0 + ph * 0.75, 0);
          }
        }
        return g;
      }
      case 'sandbags': {
        // Sacs : sphères aplaties en quinconce sur 3 rangs.
        const rows = 3;
        const bh = sy / rows;
        const geom = new THREE.SphereGeometry(1, 10, 8);
        for (let r0 = 0; r0 < rows; r0++) {
          const n = r0 % 2 === 0 ? 4 : 3;
          for (let i = 0; i < n; i++) {
            const m = add(geom.clone(), (i - (n - 1) / 2) * (sx / 4.2), r0 * bh + bh * 0.52, 0);
            m.scale.set(sx / 7.2, bh * 0.62, sz * 0.5);
          }
        }
        geom.dispose(); // seuls les clones sont montés
        return g;
      }
      case 'tire_stack': {
        // Pile de pneus : 4 tores à plat.
        const outer = Math.min(sx, sz) / 2;
        const tube = sy / 8;
        for (let i = 0; i < 4; i++) {
          add(new THREE.TorusGeometry(outer - tube, tube, 10, 20), 0, (i + 0.5) * (sy / 4), 0, mat, Math.PI / 2);
        }
        return g;
      }
      case 'tank': {
        // Citerne : cylindre horizontal + calottes + 2 berceaux.
        const r = Math.min(sy, sz) / 2 - 0.12;
        const len = sx * 0.72;
        const cy = 0.24 + r;
        add(new THREE.CylinderGeometry(r, r, len, 20), 0, cy, 0, mat, 0, Math.PI / 2);
        const cap = new THREE.SphereGeometry(r, 16, 12);
        add(cap, len / 2, cy, 0).scale.set(0.45, 1, 1);
        add(cap.clone(), -len / 2, cy, 0).scale.set(0.45, 1, 1);
        box(sx * 0.12, cy, sz * 0.8, len * 0.32, cy / 2, 0);
        box(sx * 0.12, cy, sz * 0.8, -len * 0.32, cy / 2, 0);
        return g;
      }
      case 'fence_metal': {
        // Grillage : 2 poteaux + lisse haute/basse + toile chain-link.
        if (!this.fenceMat) {
          this.fenceMat = new THREE.MeshStandardMaterial({
            map: makeChainLinkTexture(),
            transparent: true,
            side: THREE.DoubleSide,
            color: '#cfd4d8',
            roughness: 0.6,
            metalness: 0.6,
          });
        }
        box(0.08, sy, 0.08, -sx / 2 + 0.04, sy / 2, 0);
        box(0.08, sy, 0.08, sx / 2 - 0.04, sy / 2, 0);
        box(sx, 0.05, 0.05, 0, sy - 0.03, 0);
        box(sx, 0.05, 0.05, 0, 0.06, 0);
        const web = add(new THREE.PlaneGeometry(sx - 0.12, sy - 0.14), 0, sy / 2, 0, this.fenceMat);
        web.castShadow = false;
        return g;
      }
      case 'pipe': {
        // Tuyau couché + brides aux extrémités.
        const r = Math.min(sy, sz) / 2 * 0.82;
        add(new THREE.CylinderGeometry(r, r, sx * 0.96, 16), 0, r, 0, mat, 0, Math.PI / 2);
        add(new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.08, 16), sx * 0.44, r, 0, mat, 0, Math.PI / 2);
        add(new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.08, 16), -sx * 0.44, r, 0, mat, 0, Math.PI / 2);
        return g;
      }
      case 'beam': {
        // Poutre IPN : semelles + âme.
        box(sx, sy * 0.22, sz, 0, sy * 0.11, 0);
        box(sx, sy * 0.56, sz * 0.3, 0, sy * 0.5, 0);
        box(sx, sy * 0.22, sz, 0, sy * 0.89, 0);
        return g;
      }
      case 'scaffold': {
        // Échafaudage : 4 montants, lisses, plancher grillagé.
        const px = sx / 2 - 0.05;
        const pz = sz / 2 - 0.05;
        for (const ix of [-1, 1]) {
          for (const iz of [-1, 1]) {
            box(0.07, sy, 0.07, ix * px, sy / 2, iz * pz);
          }
        }
        for (const y of [sy * 0.45, sy * 0.92]) {
          box(sx, 0.06, 0.06, 0, y, -pz);
          box(sx, 0.06, 0.06, 0, y, pz);
          box(0.06, 0.06, sz, -px, y, 0);
          box(0.06, 0.06, sz, px, y, 0);
        }
        box(sx * 0.96, 0.06, sz * 0.96, 0, sy * 0.98, 0, this.shapeMat('metal_grate_rusty'));
        return g;
      }
      case 'desk_metal': {
        // Établi : plateau + 4 pieds + étagère basse.
        box(sx, 0.08, sz, 0, sy - 0.04, 0);
        box(sx * 0.94, 0.06, sz * 0.9, 0, sy * 0.32, 0);
        for (const ix of [-1, 1]) {
          for (const iz of [-1, 1]) {
            box(0.07, sy - 0.08, 0.07, ix * (sx / 2 - 0.06), (sy - 0.08) / 2, iz * (sz / 2 - 0.06));
          }
        }
        return g;
      }
      case 'gravel_heap': {
        // Tas : dôme (demi-sphère écrasée).
        const dome = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        add(dome, 0, 0, 0).scale.set(sx / 2, sy, sz / 2);
        return g;
      }
      case 'cone': {
        // Cône de chantier : socle + cône.
        box(sx * 0.85, sy * 0.06, sz * 0.85, 0, sy * 0.03, 0);
        add(new THREE.ConeGeometry(Math.min(sx, sz) * 0.32, sy * 0.94, 14), 0, sy * 0.06 + sy * 0.47, 0);
        return g;
      }
      case 'blocks': {
        // Parpaings : 2 blocs côte à côte + 1 décalé au-dessus.
        const bh = sy / 2;
        box(sx * 0.46, bh * 0.94, sz * 0.92, -sx * 0.25, bh / 2, 0);
        box(sx * 0.46, bh * 0.94, sz * 0.92, sx * 0.25, bh / 2, 0);
        box(sx * 0.46, bh * 0.94, sz * 0.92, 0, bh * 1.5, 0);
        return g;
      }
      case 'sign_panel': {
        // Panneau : 2 pieds + plaque haute.
        box(0.06, sy, 0.06, -sx * 0.35, sy / 2, 0);
        box(0.06, sy, 0.06, sx * 0.35, sy / 2, 0);
        box(sx, sy * 0.55, sz, 0, sy * 0.68, 0);
        return g;
      }
      case 'locker': {
        // Casier : corps + 2 portes en léger relief + poignées.
        box(sx, sy, sz * 0.9, 0, sy / 2, -sz * 0.05);
        box(sx * 0.44, sy * 0.94, sz * 0.12, -sx * 0.24, sy / 2, sz * 0.4);
        box(sx * 0.44, sy * 0.94, sz * 0.12, sx * 0.24, sy / 2, sz * 0.4);
        return g;
      }
      default:
        return null; // boîte texturée standard (caisse, container, mur…)
    }
  }

  /** Groupe des objets placés (raycasts de l'éditeur : placement/suppression). */
  get customObjectsGroup(): THREE.Group | null {
    return this.customGroup;
  }

  /** (Re)construit les objets placés via l'éditeur (palette intégrée ET props
   *  custom du pack). Chaque nœud porte userData.objId pour la sélection.
   *  Les props chargent leur modèle en asynchrone (placeholder boîte grise
   *  remplacé dès que le template est prêt). */
  setCustomObjects(objects: PlacedObject[], props: CustomPropDef[] = []): void {
    if (this.customGroup) {
      this.group.remove(this.customGroup);
      this.customGroup.traverse((o) => {
        // Les templates de props sont partagés (cache) — jamais disposés.
        if (o instanceof THREE.Mesh && !o.userData.sharedGeom) o.geometry.dispose();
      });
    }
    const g = new THREE.Group();
    g.name = 'custom-objects';
    for (const o of objects) {
      const size = scaledSize(o, props);
      if (!size) continue;
      const [sx, sy, sz] = size;

      if (o.kind.startsWith('prop:')) {
        const def = props.find((p) => p.id === o.kind.slice(5));
        if (!def) continue;
        // Conteneur positionné/orienté — porte l'objId pour la sélection.
        const holder = new THREE.Group();
        holder.position.set(o.x, o.y, o.z);
        holder.rotation.y = (o.rot * Math.PI) / 2;
        holder.userData.objId = o.id;
        // Placeholder : boîte grise translucide aux dimensions de collision.
        const ph = new THREE.Mesh(
          new THREE.BoxGeometry(sx, sy, sz),
          new THREE.MeshStandardMaterial({ color: '#6d7276', transparent: true, opacity: 0.5 }),
        );
        ph.position.y = sy / 2;
        ph.userData.objId = o.id;
        holder.add(ph);
        g.add(holder);
        // Modèle réel dès que le template est chargé (si le groupe est
        // toujours le groupe courant).
        void loadPropTemplate(def).then((tpl) => {
          if (!tpl || this.customGroup !== g) return;
          holder.remove(ph);
          ph.geometry.dispose();
          (ph.material as THREE.Material).dispose();
          const inst = instantiateProp(tpl);
          inst.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
          inst.traverse((n) => {
            n.userData.objId = o.id;
          });
          holder.add(inst);
        });
        continue;
      }

      const def = MAP_OBJECT_DEFS[o.kind];
      if (!def) continue;

      // Props FAÇONNÉS (fût, pneus, cône, citerne…) : vraie forme visuelle,
      // collision AABB inchangée.
      const shaped = this.buildShapedProp(o.kind, sx, sy, sz);
      if (shaped) {
        shaped.position.set(o.x, o.y, o.z);
        shaped.rotation.y = (o.rot * Math.PI) / 2;
        shaped.userData.objId = o.id;
        shaped.traverse((n) => {
          n.userData.objId = o.id;
        });
        g.add(shaped);
        continue;
      }

      let mat = this.customMats.get(o.kind);
      if (!mat) {
        mat = pbrMaterial(def.tex, { color: def.color });
        this.customMats.set(o.kind, mat);
      }
      // Échelle bakée dans la géométrie (les UV monde gardent une densité de
      // texture constante — pas d'étirement quand l'objet est agrandi).
      const geom = new THREE.BoxGeometry(sx, sy, sz);
      applyWorldUV(geom, 1.6);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(o.x, o.y + sy / 2, o.z);
      mesh.rotation.y = (o.rot * Math.PI) / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.objId = o.id;
      g.add(mesh);
    }
    this.customGroup = g;
    this.group.add(g);
  }

  /** Animations lentes : gyrophare 1 Hz, dérive de l'eau du canal. */
  update(tSec: number): void {
    if (this.beaconMat) {
      const on = Math.sin(tSec * Math.PI * 2) > -0.2;
      this.beaconMat.color.set(on ? COLOR_AMBER : '#3A2A12');
    }
    if (this.waterMat?.map) {
      this.waterMat.map.offset.x = tSec * 0.006;
      this.waterMat.map.offset.y = Math.sin(tSec * 0.12) * 0.02;
    }
  }
}

/** Bruit pour l'eau du canal. */
function makeWaterTexture(): THREE.CanvasTexture {
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const rng = (() => {
    let a = 2025;
    return () => {
      a = (a * 1664525 + 1013904223) % 4294967296;
      return a / 4294967296;
    };
  })();
  ctx.fillStyle = '#22333F';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    const v = 30 + Math.floor(rng() * 50);
    ctx.fillStyle = `rgba(${v},${v + 16},${v + 28},${0.12 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(rng() * s, rng() * s, 4 + rng() * 22, 1 + rng() * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Bandes hazard jaune/noir. */
function makeHazardTexture(): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#C9A227';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#1C1E22';
  for (let x = -s; x < s * 2; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 16, 0);
    ctx.lineTo(x + 16 + s, s);
    ctx.lineTo(x + s, s);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
