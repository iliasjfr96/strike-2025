// ============================================================================
// STRIKE 2025 — WeaponView.ts
// Viewmodel 1re personne procédural détaillé : canons cylindriques, carcasses
// biseautées, rails segmentés, viseurs (point rouge à lentille / lunette tube),
// chargeurs animés au reload (descente + remontée + geste de culasse), ADS
// aligné sur l'axe de la visée PROPRE À CHAQUE ARME, recul, sway, bob, tilt
// sprint, muzzle flash au bout du canon (quad + PointLight 40 ms).
// Le groupe est enfant de la caméra (coordonnées caméra, -Z = avant).
// ============================================================================

import * as THREE from 'three';
import type { WeaponId } from '../../shared/protocol';
import { loadWeaponModel } from './WeaponModels';
import { VIEWMODEL_LAYER } from './Renderer';

const FLASH_MS = 55;

/** Position de repos (hanche) — X/Y fixes, Z dépend de la longueur de l'arme
 *  (l'arrière de l'arme doit toujours rester devant le near-plane caméra). */
const HIP_X = 0.24;
const HIP_Y = -0.24;
/** Z de la hanche pour une arme de longueur L : -(HIP_Z_BASE + L × HIP_Z_PER_M). */
const HIP_Z_BASE = 0.18;
const HIP_Z_PER_M = 0.42;
/** En visée l'arme se rapproche légèrement (centrage naturel). */
const ADS_Z_PULL = 0.06;
/** Facteur d'échelle viewmodel (présence à l'écran — propagé aux repères). */
const VIEWMODEL_SCALE = 1.0;

const flashTexLoader = new THREE.TextureLoader();
let muzzleTex: THREE.Texture | null = null;
let smokeTex: THREE.Texture | null = null;
function getMuzzleTex(): THREE.Texture {
  if (!muzzleTex) {
    muzzleTex = flashTexLoader.load('./fx-muzzle.png');
    muzzleTex.colorSpace = THREE.SRGBColorSpace;
  }
  return muzzleTex;
}
function getSmokeTex(): THREE.Texture {
  if (!smokeTex) {
    smokeTex = flashTexLoader.load('./fx-smoke.png');
    smokeTex.colorSpace = THREE.SRGBColorSpace;
  }
  return smokeTex;
}

export interface WeaponViewFrame {
  /** 0..1 progression ADS (déjà lissée par GameClient sur adsMs). */
  adsT: number;
  /** Vitesse horizontale du joueur (m/s) pour le bob / tilt sprint. */
  speed: number;
  onGround: boolean;
  /** Deltas souris de la frame (px) pour le sway. */
  lookDX: number;
  lookDY: number;
}

interface GunParts {
  root: THREE.Group;
  muzzle: THREE.Object3D;
  /** Y local de l'axe de visée (sight) — utilisé pour centrer l'ADS. */
  adsY: number;
  /** Chargeur (animé au reload), ou null. */
  mag: THREE.Object3D | null;
  /** Culasse / verrou (animé au reload), ou null. */
  bolt: THREE.Object3D | null;
  length: number;
  /** Vrai si c'est un clone GLB partagé (ne pas disposer géométrie/matériau). */
  shared?: boolean;
}

export class WeaponView {
  readonly group = new THREE.Group();
  private readonly camera: THREE.PerspectiveCamera;
  private gun: GunParts | null = null;
  private weaponId: WeaponId | null = null;
  private gunSeq = 0;
  private readonly flash: THREE.Sprite;
  private readonly flashLight: THREE.PointLight;
  private flashUntil = 0;
  /** Fumée de bouche après le tir (petit pool). */
  private readonly smokes: { sprite: THREE.Sprite; age: number; active: boolean }[] = [];

  // Animation state
  private bobT = 0;
  private swayX = 0;
  private swayY = 0;
  private kickPos = 0;
  private kickRot = 0;
  private reloadT = -1; // -1 inactif, sinon 0..1
  private reloadDur = 1;
  private drawT = 1; // 0→1 à la sortie d'arme
  /** Progression ADS lissée (couper la fumée de bouche en visée). */
  private adsSmooth = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.group.name = 'weapon-view';
    camera.add(this.group);

    // Flash de bouche : sprite texturé (fx-muzzle.png) + PointLight brève.
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getMuzzleTex(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.95,
      }),
    );
    this.flash.scale.set(0.5, 0.5, 1);
    this.flash.visible = false;
    this.group.add(this.flash);
    this.flashLight = new THREE.PointLight('#FFC268', 0, 6, 2);
    this.group.add(this.flashLight);
    // Pool fumée de bouche.
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getSmokeTex(),
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      s.scale.set(0.18, 0.18, 1);
      s.visible = false;
      this.group.add(s);
      this.smokes.push({ sprite: s, age: 0, active: false });
    }

    // Tout le viewmodel vit sur le layer dédié (passe de rendu à FOV fixe).
    this.group.traverse((o) => o.layers.set(VIEWMODEL_LAYER));
    // La lumière du flash éclaire AUSSI le monde (layer 0) : mur/props voisins.
    this.flashLight.layers.enable(0);
  }

  get currentWeapon(): WeaponId | null {
    return this.weaponId;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Change l'arme affichée : placeholder procédural immédiat, puis le VRAI
   *  modèle GLB dès qu'il est chargé (swap transparent). */
  setWeapon(id: WeaponId): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.swapGun(buildGun(id));
    this.gunSeq++;
    const seq = this.gunSeq;
    void loadWeaponModel(id).then((n) => {
      if (n === null || seq !== this.gunSeq || this.weaponId !== id) return;
      // Instance unique par arme : on utilise l'original normalisé DIRECTEMENT
      // (les modèles skinnés — Armature — ne supportent pas Object3D.clone).
      this.swapGun(
        { root: n.root, muzzle: n.muzzle, adsY: n.adsY, mag: n.mag, bolt: n.bolt, length: n.length, shared: true },
      );
    });
  }

  /** Recharge le modèle de l'arme courante (mods d'armurerie appliqués). */
  refreshModel(): void {
    const id = this.weaponId;
    if (id === null) return;
    this.weaponId = null; // force le passage complet de setWeapon
    this.setWeapon(id);
  }

  /** Installe un modèle d'arme (procédural ou GLB cloné). */
  private swapGun(g: GunParts): void {
    if (this.gun) {
      this.group.remove(this.gun.root);
      if (this.gun.shared) {
        // Clone GLB : géométrie/matériaux partagés — on retire sans disposer.
      } else {
        disposeGroup(this.gun.root);
      }
    }
    this.gun = g;
    // Repères initiaux des nœuds animables (reload).
    if (g.mag) g.mag.userData.y0 = g.mag.position.y;
    if (g.bolt) g.bolt.userData.z0 = g.bolt.position.z;
    g.root.scale.setScalar(VIEWMODEL_SCALE);
    this.attachHands(g);
    this.group.add(g.root);
    // Layer viewmodel sur tout le sous-arbre fraîchement ajouté.
    g.root.traverse((o) => o.layers.set(VIEWMODEL_LAYER));
    // Le flash/la lumière sont enfants du GROUP (non scalé) : le repère muzzle
    // (local au root scalé) doit être multiplié par l'échelle du viewmodel.
    const mz = g.muzzle.position;
    this.flash.position.copy(mz).multiplyScalar(VIEWMODEL_SCALE);
    this.flash.position.z -= 0.1;
    this.flashLight.position.copy(mz).multiplyScalar(VIEWMODEL_SCALE);
    this.drawT = 0;
  }

  /** Kick de recul viewmodel (intensité ~ recul vertical de l'arme). */
  kick(strength: number): void {
    this.kickPos += 0.012 + strength * 0.012;
    this.kickRot += 0.02 + strength * 0.014;
  }

  muzzleFlash(): void {
    this.flashUntil = performance.now() + FLASH_MS;
    // Fumée de bouche : coupée en visée (elle masquerait la ligne de mire),
    // sinon spawn légèrement devant le canon.
    if (this.adsSmooth > 0.4) return;
    const s = this.smokes.find((x) => !x.active) ?? this.smokes[0];
    if (s && this.gun) {
      s.sprite.position.copy(this.gun.muzzle.position).multiplyScalar(VIEWMODEL_SCALE);
      s.sprite.position.z -= 0.22;
      s.sprite.scale.set(0.12, 0.12, 1);
      s.age = 0;
      s.active = true;
      s.sprite.visible = true;
    }
  }

  startReload(ms: number): void {
    this.reloadT = 0;
    this.reloadDur = Math.max(0.001, ms / 1000);
  }

  cancelReload(): void {
    this.reloadT = -1;
    if (this.gun?.mag) this.gun.mag.visible = true;
    if (this.gun?.bolt) this.gun.bolt.position.z = this.gun.bolt.userData.z0 as number;
  }

  /** Attache des mains gantées procédurales aux points de préhension
   *  (poignée pour la droite, garde-main pour la gauche sur les longues). */
  private attachHands(g: GunParts): void {
    if (!g.shared) return; // uniquement sur les vrais modèles GLB
    // L'instance GLB est PARTAGÉE (cache) : retirer les mains d'un passage
    // précédent avant d'en rattacher (sinon accumulation à chaque switch).
    for (const child of [...g.root.children]) {
      if (child.userData.isHand) g.root.remove(child);
    }
    const box = new THREE.Box3().setFromObject(g.root);
    const minZ = box.min.z;
    const len = Math.max(0.01, box.max.z - box.min.z);
    const isPistol = g.length < 0.4;
    const glove = new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.88, metalness: 0.05 });
    const sleeve = new THREE.MeshStandardMaterial({ color: '#2A3036', roughness: 0.92, metalness: 0.05 });

    const mkHand = (): THREE.Group => {
      const h = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.045, 0.075), glove);
      palm.castShadow = false;
      h.add(palm);
      // Doigts refermés sur la poignée/le garde-main.
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.045, 0.02), glove);
        f.position.set(-0.02 + i * 0.02, -0.01, -0.045);
        f.rotation.x = 0.5;
        h.add(f);
      }
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.04, 0.02), glove);
      thumb.position.set(0.035, 0.005, -0.02);
      thumb.rotation.z = -0.4;
      h.add(thumb);
      const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.09), sleeve);
      wrist.position.set(0, -0.005, 0.085);
      h.add(wrist);
      return h;
    };

    // Main droite : poignée pistolet (~62-72 % de la longueur depuis le canon).
    const right = mkHand();
    const rz = minZ + len * (isPistol ? 0.74 : 0.6);
    right.position.set(0.005, box.min.y - 0.012, rz);
    right.rotation.set(0.25, 0, 0);
    markHand(right);
    g.root.add(right);
    // Main gauche : sous le garde-main (~30 %), fusils seulement.
    if (!isPistol) {
      const left = mkHand();
      left.position.set(-0.01, box.min.y - 0.002, minZ + len * 0.3);
      left.rotation.set(-0.5, 0, 0.15);
      markHand(left);
      g.root.add(left);
    }
  }

  /** Décroissance seule (viewmodel masqué — ex. visée lunette) : le recul ne
   *  doit pas s'accumuler pour ressortir d'un coup au dé-zoom. */
  decayOnly(dt: number): void {
    const kickK = Math.min(1, dt * 11);
    this.kickPos -= this.kickPos * kickK;
    this.kickRot -= this.kickRot * kickK;
  }

  /** Position monde de la pointe du canon (départ des tracantes locales). */
  getMuzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (this.gun) {
      this.gun.muzzle.getWorldPosition(out);
    } else {
      out.setFromMatrixPosition(this.camera.matrixWorld);
    }
    return out;
  }

  update(dt: number, frame: WeaponViewFrame): void {
    const now = performance.now();
    const ads = frame.adsT;
    this.adsSmooth = ads;
    // Ligne de mire au centre écran : adsY est en espace root, le root est
    // scalé par VIEWMODEL_SCALE — l'offset doit suivre.
    const adsY = this.gun ? -this.gun.adsY * VIEWMODEL_SCALE : -0.17;
    // Position hanche : Z proportionnel à la longueur (jamais la caméra DANS
    // l'arme — l'arrière du modèle reste devant le near-plane viewmodel).
    const gunLen = (this.gun ? this.gun.length : 0.6) * VIEWMODEL_SCALE;
    const hipZ = -(HIP_Z_BASE + gunLen * HIP_Z_PER_M);
    const adsZ = hipZ + ADS_Z_PULL;

    // ---- Bob de marche (atténué en ADS) -------------------------------------
    const moving = frame.speed > 0.4 && frame.onGround;
    if (moving) {
      this.bobT += dt * (4.5 + frame.speed * 0.9);
    }
    const sprint = frame.speed > 5.6 && ads < 0.3;
    const bobAmp = moving ? 0.011 * (1 - ads * 0.85) : 0;
    const bobX = Math.sin(this.bobT) * bobAmp;
    const bobY = -Math.abs(Math.cos(this.bobT)) * bobAmp * 0.8;

    // ---- Sway souris (inertie opposée au mouvement) --------------------------
    const swayTargetX = THREE.MathUtils.clamp(-frame.lookDX * 0.0006, -0.03, 0.03) * (1 - ads * 0.8);
    const swayTargetY = THREE.MathUtils.clamp(frame.lookDY * 0.0005, -0.025, 0.025) * (1 - ads * 0.8);
    const swayK = Math.min(1, dt * 9);
    this.swayX += (swayTargetX - this.swayX) * swayK;
    this.swayY += (swayTargetY - this.swayY) * swayK;

    // ---- Recul (décroissance exponentielle) ----------------------------------
    const kickK = Math.min(1, dt * 11);
    this.kickPos -= this.kickPos * kickK;
    this.kickRot -= this.kickRot * kickK;

    // ---- Sortie d'arme (monte depuis le bas) ---------------------------------
    if (this.drawT < 1) {
      this.drawT = Math.min(1, this.drawT + dt / 0.28);
    }
    const drawDrop = (1 - easeOut(this.drawT)) * 0.25;

    // ---- Reload : dip + tilt + chargeur + culasse -----------------------------
    let reloadDip = 0;
    let reloadTilt = 0;
    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      if (this.reloadT >= 1) {
        this.reloadT = -1;
        if (this.gun?.mag) this.gun.mag.visible = true;
        if (this.gun?.bolt) this.gun.bolt.position.z = this.gun.bolt.userData.z0 as number;
      } else {
        const s = Math.sin(this.reloadT * Math.PI);
        reloadDip = s * 0.11;
        reloadTilt = s * 0.32;
        // Chargeur : retiré au tiers du geste, remis au deux-tiers (plus propre
        // qu'une translation sur les modèles réels aux axes variés).
        if (this.gun?.mag) {
          this.gun.mag.visible = !(this.reloadT > 0.22 && this.reloadT < 0.62);
        }
        // Culasse : recule sur la fin (geste de rechargement).
        if (this.gun?.bolt) {
          const z0 = this.gun.bolt.userData.z0 as number;
          const phase = THREE.MathUtils.clamp((this.reloadT - 0.6) / 0.3, 0, 1);
          this.gun.bolt.position.z = z0 + Math.sin(phase * Math.PI) * 0.045;
        }
      }
    }

    // ---- Tilt sprint (arme baisse et pivote) ---------------------------------
    const sprintTilt = sprint ? 0.5 : 0;
    const sprintDrop = sprint ? 0.09 : 0;

    // ---- Composition finale ---------------------------------------------------
    const posX = THREE.MathUtils.lerp(HIP_X, 0, ads);
    const posY = THREE.MathUtils.lerp(HIP_Y, adsY, ads);
    const posZ = THREE.MathUtils.lerp(hipZ, adsZ, ads);
    this.group.position.set(
      posX + bobX + this.swayX,
      posY + bobY + this.swayY - reloadDip - drawDrop - sprintDrop,
      posZ + this.kickPos,
    );
    this.group.rotation.set(
      -this.kickRot - reloadDip * 0.6 + sprintTilt * 0.5,
      this.swayX * 1.6 + sprintTilt * 0.4,
      this.swayX * 0.8 + reloadTilt + sprintTilt * 0.35,
    );

    // ---- Flash ----------------------------------------------------------------
    const flashing = now < this.flashUntil;
    this.flash.visible = flashing;
    this.flashLight.intensity = flashing ? 5.5 : 0;
    if (flashing) {
      const s = 0.42 + Math.random() * 0.2;
      this.flash.scale.set(s, s, 1);
      (this.flash.material as THREE.SpriteMaterial).rotation = (Math.random() - 0.5) * 0.35;
    }

    // ---- Fumée de bouche (monte, s'élargit, s'estompe) -------------------------
    for (const sm of this.smokes) {
      if (!sm.active) continue;
      sm.age += dt;
      const life = 0.85;
      if (sm.age >= life) {
        sm.active = false;
        sm.sprite.visible = false;
        (sm.sprite.material as THREE.SpriteMaterial).opacity = 0;
        continue;
      }
      const t = sm.age / life;
      sm.sprite.position.y += dt * 0.28;
      const sc = 0.12 + t * 0.26;
      sm.sprite.scale.set(sc, sc, 1);
      (sm.sprite.material as THREE.SpriteMaterial).opacity = 0.22 * (1 - t);
    }
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Marque une main procédurale (et tout son sous-arbre) : exclue du merge des
 *  armes distantes (mergedWeapon) et retirée avant chaque ré-attache. */
function markHand(h: THREE.Object3D): void {
  h.userData.isHand = true;
  h.traverse((o) => {
    o.userData.isHand = true;
  });
}

function disposeGroup(root: THREE.Group): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else {
        mat.dispose();
      }
    }
  });
}

// ----------------------------------------------------------------------------
// Construction procédurale détaillée des armes
// ----------------------------------------------------------------------------

interface Mats {
  metal: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  lens: THREE.MeshStandardMaterial;
}

function mats(): Mats {
  return {
    metal: new THREE.MeshStandardMaterial({ color: '#3A4046', roughness: 0.38, metalness: 0.78, envMapIntensity: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1B1E22', roughness: 0.55, metalness: 0.4, envMapIntensity: 0.6 }),
    polymer: new THREE.MeshStandardMaterial({ color: '#24282D', roughness: 0.85, metalness: 0.1, envMapIntensity: 0.4 }),
    accent: new THREE.MeshStandardMaterial({ color: '#F59E1F', emissive: new THREE.Color('#F59E1F'), emissiveIntensity: 0.22, roughness: 0.5, metalness: 0.3 }),
    lens: new THREE.MeshStandardMaterial({ color: '#7A1010', emissive: new THREE.Color('#FF2020'), emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.4 }),
  };
}

function box(parent: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function cyl(parent: THREE.Group, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Rail Picatinny segmenté sur le dessus. */
function rail(parent: THREE.Group, m: Mats, y: number, z0: number, z1: number): void {
  for (let z = z0; z < z1; z += 0.035) {
    box(parent, m.dark, 0.045, 0.012, 0.02, 0, y, z);
  }
}

/** Point rouge avec lentille. */
function redDot(parent: THREE.Group, m: Mats, y: number, z: number): void {
  box(parent, m.dark, 0.036, 0.014, 0.05, 0, y - 0.02, z); // embase
  const bodyMesh = box(parent, m.dark, 0.04, 0.045, 0.075, 0, y + 0.008, z);
  bodyMesh.scale.set(1, 1, 1);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.011, 12), m.lens);
  lens.position.set(0, y + 0.012, z - 0.039);
  lens.rotation.y = Math.PI;
  parent.add(lens);
}

/** Construit le viewmodel d'une arme. Le canon pointe vers -Z. */
function buildGun(id: WeaponId): GunParts {
  // Armes custom : silhouette de fusil d'assaut en attendant le GLB du pack.
  if (id.startsWith('custom')) id = 'vsk27';
  const root = new THREE.Group();
  const m = mats();
  const muzzle = new THREE.Object3D();
  let length = 0.6;
  let adsY = 0.09;
  let mag: THREE.Mesh | null = null;
  let bolt: THREE.Mesh | null = null;

  switch (id) {
    case 'vsk27': {
      // Fusil d'assaut bullpup : carcasse arrière longue, canon cylindrique.
      length = 0.68;
      adsY = 0.098;
      box(root, m.metal, 0.075, 0.1, 0.46, 0, 0, -0.05); // carcasse
      box(root, m.polymer, 0.065, 0.09, 0.22, 0, -0.01, 0.2); // crosse
      cyl(root, m.metal, 0.016, 0.32, 0, 0.02, -0.42); // canon
      cyl(root, m.dark, 0.024, 0.06, 0, 0.02, -0.585); // cache-flamme
      box(root, m.polymer, 0.055, 0.05, 0.2, 0, -0.035, -0.4); // garde-main
      mag = box(root, m.dark, 0.05, 0.17, 0.075, 0, -0.12, -0.02); // chargeur cintré
      mag.rotation.x = 0.12;
      bolt = box(root, m.metal, 0.02, 0.025, 0.05, 0.045, 0.03, 0.02); // levier culasse
      box(root, m.polymer, 0.045, 0.1, 0.06, 0, -0.1, 0.14); // poignée
      rail(root, m, 0.055, -0.22, 0.06);
      redDot(root, m, 0.098, -0.08);
      box(root, m.accent, 0.076, 0.012, 0.16, 0, 0.028, -0.02); // liseré ambre
      box(root, m.dark, 0.025, 0.055, 0.05, 0, -0.075, -0.33); // grip avant
      break;
    }
    case 'kv9': {
      // PM compact CQC.
      length = 0.5;
      adsY = 0.088;
      box(root, m.metal, 0.07, 0.095, 0.34, 0, 0, -0.04);
      cyl(root, m.metal, 0.017, 0.2, 0, 0.015, -0.29);
      cyl(root, m.dark, 0.028, 0.09, 0, 0.015, -0.36); // embout type suppresseur court
      mag = box(root, m.dark, 0.05, 0.21, 0.06, 0, -0.145, 0.0); // chargeur courbe
      mag.rotation.x = -0.18;
      bolt = box(root, m.metal, 0.018, 0.02, 0.045, 0.042, 0.028, -0.05);
      box(root, m.polymer, 0.045, 0.09, 0.05, 0, -0.095, 0.11);
      box(root, m.dark, 0.05, 0.05, 0.15, 0, -0.005, 0.19); // crosse pliée
      rail(root, m, 0.052, -0.16, 0.04);
      redDot(root, m, 0.088, -0.06);
      box(root, m.accent, 0.072, 0.01, 0.12, 0, 0.028, -0.05);
      box(root, m.polymer, 0.05, 0.045, 0.14, 0, -0.04, -0.22); // garde-main large
      break;
    }
    case 'lr50': {
      // Sniper à verrou long.
      length = 0.98;
      adsY = 0.118;
      box(root, m.metal, 0.07, 0.1, 0.5, 0, 0, -0.02);
      cyl(root, m.metal, 0.015, 0.55, 0, 0.015, -0.52); // canon cannelé
      // Cannelures du canon.
      for (let i = 0; i < 5; i++) {
        cyl(root, m.dark, 0.019, 0.02, 0, 0.015, -0.38 - i * 0.09);
      }
      box(root, m.dark, 0.055, 0.055, 0.1, 0, 0.015, -0.82); // frein de bouche
      box(root, m.polymer, 0.06, 0.1, 0.28, 0, -0.01, 0.27); // crosse
      box(root, m.polymer, 0.045, 0.09, 0.05, 0, -0.1, 0.12); // poignée
      mag = box(root, m.dark, 0.05, 0.13, 0.07, 0, -0.11, -0.08);
      bolt = box(root, m.metal, 0.025, 0.025, 0.09, 0.05, 0.045, 0.03); // verrou
      box(root, m.metal, 0.02, 0.02, 0.03, 0.05, 0.075, 0.06); // bille de verrou
      // Lunette : tube + oculaire + montures.
      const scope = cyl(root, m.dark, 0.026, 0.26, 0, 0.115, -0.06);
      scope.scale.set(1, 1, 1);
      cyl(root, m.dark, 0.031, 0.04, 0, 0.115, 0.08); // oculaire
      cyl(root, m.dark, 0.033, 0.05, 0, 0.115, -0.19); // objectif
      box(root, m.metal, 0.02, 0.045, 0.02, 0, 0.07, 0.0); // monture 1
      box(root, m.metal, 0.02, 0.045, 0.02, 0, 0.07, -0.13); // monture 2
      rail(root, m, 0.055, -0.16, 0.1);
      box(root, m.accent, 0.052, 0.01, 0.05, 0, 0.142, 0.02); // tag ambre
      // Bipied replié sous le canon.
      box(root, m.dark, 0.02, 0.02, 0.22, 0, -0.02, -0.5);
      break;
    }
    case 'p9': {
      // Pistolet de service compact.
      length = 0.27;
      adsY = 0.062;
      box(root, m.metal, 0.05, 0.07, 0.24, 0, 0.01, -0.06); // glissière
      // Serrations de glissière.
      for (let i = 0; i < 4; i++) {
        box(root, m.dark, 0.052, 0.05, 0.008, 0, 0.012, 0.02 + i * 0.016);
      }
      box(root, m.dark, 0.02, 0.02, 0.05, 0, 0.005, -0.19); // canon fileté
      mag = box(root, m.polymer, 0.048, 0.13, 0.07, 0, -0.085, 0.05); // poignée/chargeur
      mag.rotation.x = -0.12;
      box(root, m.dark, 0.02, 0.025, 0.03, 0, 0.058, -0.15); // guidon tritium
      box(root, m.accent, 0.021, 0.012, 0.012, 0, 0.058, -0.162);
      box(root, m.dark, 0.018, 0.02, 0.035, 0, 0.058, 0.04); // hausse
      break;
    }
  }

  if (mag) mag.userData.y0 = mag.position.y;
  if (bolt) bolt.userData.z0 = bolt.position.z;

  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
    }
  });

  muzzle.position.set(0, 0.015, -length);
  root.add(muzzle);
  return { root, muzzle, adsY, mag, bolt, length };
}
