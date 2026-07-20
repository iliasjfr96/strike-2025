// ============================================================================
// STRIKE 2025 — PlayersRenderer.ts
// Avatars humanoïdes procéduraux des joueurs distants : jambes articulées avec
// cycle de marche/course (∝ vitesse), torse capsule + gilet + sac, bras tenant
// l'arme, tête casque + visière, accents lumineux d'équipe, pseudo en sprite.
// États : idle (respiration), crouch (pose pliée), mort (chute), pitch du haut
// du corps, muzzle flash distant, armes distinctes par silhouette.
// ============================================================================

import * as THREE from 'three';
import type { ClassId, PlayerInfo, TeamId, WeaponId, WeaponSlot } from '../../shared/protocol';
import { weaponForSlot } from '../../shared/weapons';
import type { InterpState } from '../net/Interpolation';
import { loadWeaponModel, mergedWeapon } from './WeaponModels';

const remoteFlashTex = new THREE.TextureLoader();
let remoteMuzzleTex: THREE.Texture | null = null;
function getRemoteMuzzleTex(): THREE.Texture {
  if (!remoteMuzzleTex) {
    remoteMuzzleTex = remoteFlashTex.load('./fx-muzzle.png');
    remoteMuzzleTex.colorSpace = THREE.SRGBColorSpace;
  }
  return remoteMuzzleTex;
}

const TEAM_ACCENT: Record<TeamId, string> = {
  0: '#58A6E8', // SPECTRE
  1: '#F07F13', // RAVAGE
};

const FLASH_MS = 40;
const STALE_MS = 1200;

// ---- Matériaux partagés ------------------------------------------------------
let clothMat: THREE.MeshStandardMaterial | null = null;
let vestMat: THREE.MeshStandardMaterial | null = null;
let gearMat: THREE.MeshStandardMaterial | null = null;
let gunMat: THREE.MeshStandardMaterial | null = null;
const accentMats = new Map<TeamId, THREE.MeshStandardMaterial>();
const visorMats = new Map<TeamId, THREE.MeshStandardMaterial>();

function getClothMat(): THREE.MeshStandardMaterial {
  if (!clothMat) {
    clothMat = new THREE.MeshStandardMaterial({ color: '#2A3036', roughness: 0.92, metalness: 0.08, envMapIntensity: 0.4 });
  }
  return clothMat;
}
function getVestMat(): THREE.MeshStandardMaterial {
  if (!vestMat) {
    vestMat = new THREE.MeshStandardMaterial({ color: '#1E2328', roughness: 0.85, metalness: 0.15, envMapIntensity: 0.4 });
  }
  return vestMat;
}
function getGearMat(): THREE.MeshStandardMaterial {
  if (!gearMat) {
    gearMat = new THREE.MeshStandardMaterial({ color: '#14171B', roughness: 0.7, metalness: 0.3 });
  }
  return gearMat;
}
function getGunMat(): THREE.MeshStandardMaterial {
  if (!gunMat) {
    gunMat = new THREE.MeshStandardMaterial({ color: '#2B2F34', roughness: 0.45, metalness: 0.7, envMapIntensity: 0.7 });
  }
  return gunMat;
}
function getAccentMat(team: TeamId): THREE.MeshStandardMaterial {
  let m = accentMats.get(team);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: TEAM_ACCENT[team],
      emissive: new THREE.Color(TEAM_ACCENT[team]),
      emissiveIntensity: 0.9,
      roughness: 0.6,
      metalness: 0.2,
    });
    accentMats.set(team, m);
  }
  return m;
}
function getVisorMat(team: TeamId): THREE.MeshStandardMaterial {
  let m = visorMats.get(team);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: '#0A0E12',
      emissive: new THREE.Color(TEAM_ACCENT[team]),
      emissiveIntensity: 0.35,
      roughness: 0.15,
      metalness: 0.6,
    });
    visorMats.set(team, m);
  }
  return m;
}

interface Avatar {
  root: THREE.Group;
  body: THREE.Group; // pivot ragdoll / crouch
  hips: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  torso: THREE.Group; // pivot pitch
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  gun: THREE.Group;
  muzzle: THREE.Object3D;
  flash: THREE.Mesh;
  nameSprite: THREE.Sprite;
  team: TeamId;
  classId: ClassId;
  weaponId: WeaponId;
  // animation
  walkPhase: number;
  speed: number;
  prevX: number;
  prevZ: number;
  crouchT: number;
  deathT: number;
  idleT: number;
  flashUntil: number;
  lastSeenAt: number;
}

/** Sprite de pseudo (CanvasTexture, couleur d'équipe). */
function makeNameSprite(name: string, team: TeamId): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 56;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 56);
    ctx.fillStyle = 'rgba(6, 9, 12, 0.55)';
    ctx.fillRect(28, 8, 200, 38);
    ctx.font = '600 26px Rajdhani, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TEAM_ACCENT[team];
    const shown = name.length > 14 ? `${name.slice(0, 13)}…` : name;
    ctx.fillText(shown, 128, 28);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.7, 0.372, 1);
  return sprite;
}

/** Fabrique d'arme tenue (silhouettes distinctes par arme). */
function buildGunModel(wid: WeaponId): { gun: THREE.Group; muzzleLocal: THREE.Vector3 } {
  // Armes custom : silhouette AR en attendant le modèle du pack.
  if (wid.startsWith('custom')) wid = 'vsk27';
  const g = new THREE.Group();
  const mat = getGunMat();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx !== 0) m.rotation.x = rx;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  let muzzleLocal: THREE.Vector3 = new THREE.Vector3(0, 0.03, -0.66);
  switch (wid) {
    case 'vsk27': {
      add(new THREE.BoxGeometry(0.07, 0.14, 0.5), 0, 0, -0.1); // receiver bullpup
      add(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), 0, 0.03, -0.48, Math.PI / 2); // canon
      add(new THREE.BoxGeometry(0.05, 0.16, 0.08), 0, -0.12, -0.16); // chargeur cintré
      add(new THREE.BoxGeometry(0.04, 0.05, 0.12), 0, 0.1, -0.18); // point rouge
      add(new THREE.BoxGeometry(0.05, 0.05, 0.2), 0, -0.045, -0.38); // garde-main
      muzzleLocal = new THREE.Vector3(0, 0.03, -0.66);
      break;
    }
    case 'kv9': {
      add(new THREE.BoxGeometry(0.07, 0.12, 0.34), 0, 0, -0.06);
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.2, 8), 0, 0.02, -0.32, Math.PI / 2);
      add(new THREE.BoxGeometry(0.05, 0.2, 0.07), 0, -0.14, -0.08); // gros chargeur
      add(new THREE.BoxGeometry(0.03, 0.06, 0.1), 0, -0.03, 0.12); // crosse pliée
      muzzleLocal = new THREE.Vector3(0, 0.02, -0.43);
      break;
    }
    case 'lr50': {
      add(new THREE.BoxGeometry(0.07, 0.13, 0.7), 0, 0, -0.2); // long receiver
      add(new THREE.CylinderGeometry(0.02, 0.024, 0.5, 8), 0, 0.02, -0.75, Math.PI / 2); // canon cannelé
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10), 0, 0.11, -0.28, Math.PI / 2); // lunette
      add(new THREE.BoxGeometry(0.05, 0.14, 0.09), 0, -0.11, -0.3);
      add(new THREE.BoxGeometry(0.06, 0.1, 0.22), 0, -0.02, 0.22); // crosse
      muzzleLocal = new THREE.Vector3(0, 0.02, -1.01);
      break;
    }
    case 'p9': {
      add(new THREE.BoxGeometry(0.05, 0.09, 0.22), 0, 0.02, -0.04);
      add(new THREE.BoxGeometry(0.045, 0.12, 0.06), 0, -0.06, 0.05); // poignée
      muzzleLocal = new THREE.Vector3(0, 0.04, -0.16);
      break;
    }
  }
  return { gun: g, muzzleLocal };
}

export class PlayersRenderer {
  private readonly scene: THREE.Scene;
  private readonly avatars = new Map<number, Avatar>();
  private readonly roster = new Map<number, PlayerInfo>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setRoster(players: PlayerInfo[]): void {
    this.roster.clear();
    for (const p of players) this.roster.set(p.id, p);
  }

  addPlayer(p: PlayerInfo): void {
    this.roster.set(p.id, p);
  }

  removePlayer(id: number): void {
    this.roster.delete(id);
    this.destroyAvatar(id);
  }

  clearAll(): void {
    for (const id of [...this.avatars.keys()]) this.destroyAvatar(id);
    this.roster.clear();
  }

  /** Met à jour un avatar depuis un état interpolé (à chaque frame). */
  update(id: number, s: InterpState, nowMs: number, dt: number): void {
    const info = this.roster.get(id);
    if (!info) return;
    let av = this.avatars.get(id);
    if (!av) {
      av = this.buildAvatar(info);
      av.prevX = s.x;
      av.prevZ = s.z;
      this.avatars.set(id, av);
    }
    av.lastSeenAt = nowMs;
    av.root.visible = true;
    av.root.position.set(s.x, s.y, s.z);
    av.root.rotation.y = s.yaw;

    // Vitesse estimée (pour le cycle de marche).
    if (dt > 0.0001) {
      const v = Math.hypot(s.x - av.prevX, s.z - av.prevZ) / dt;
      av.speed += (v - av.speed) * Math.min(1, dt * 8);
    }
    av.prevX = s.x;
    av.prevZ = s.z;

    const dead = s.hp <= 0;
    const crouchTarget = s.stance === 1 && !dead ? 1 : 0;
    av.crouchT += (crouchTarget - av.crouchT) * Math.min(1, dt * 10);
    av.deathT += ((dead ? 1 : 0) - av.deathT) * Math.min(1, dt * 5);
    av.idleT += dt;

    this.animate(av, s, dt);

    // Arme en main (changement de slot).
    const wid = weaponForSlot(av.classId, s.weaponSlot as WeaponSlot);
    if (wid !== av.weaponId) {
      this.rebuildGun(av, wid);
    }

    // Muzzle flash.
    const flashing = nowMs < av.flashUntil && !dead;
    av.flash.visible = flashing;
    if (flashing) {
      const scale = 0.7 + Math.random() * 0.6;
      av.flash.scale.set(scale, scale, scale);
      av.flash.rotation.z = Math.random() * Math.PI;
    }
  }

  /** Cycle de marche / idle / crouch / mort. */
  private animate(av: Avatar, s: InterpState, dt: number): void {
    const speedN = Math.min(1, av.speed / 6.5);
    av.walkPhase += av.speed * dt * 2.1;
    const swing = Math.sin(av.walkPhase) * (0.25 + speedN * 0.45);
    const swing2 = Math.sin(av.walkPhase + Math.PI) * (0.25 + speedN * 0.45);

    // Jambes : balancement de marche, pliées en crouch, relâchées à la mort.
    const crouchBend = av.crouchT * 0.7;
    av.legL.rotation.x = swing * (1 - av.deathT) - crouchBend;
    av.legR.rotation.x = swing2 * (1 - av.deathT) - crouchBend;

    // Corps : respiration idle + bob de marche ; abaissé en crouch.
    const breathe = Math.sin(av.idleT * 2.2) * 0.008 * (1 - speedN);
    const bob = Math.abs(Math.sin(av.walkPhase)) * 0.03 * speedN;
    av.torso.position.y = 0.95 - av.crouchT * 0.32 + breathe + bob;
    av.hips.position.y = 0.88 - av.crouchT * 0.3 + bob * 0.5;

    // Haut du corps suit le pitch de visée.
    av.torso.rotation.x = -s.pitch * 0.45 * (1 - av.deathT);

    // Bras : contre-balancement léger, ramenés en crouch.
    av.armL.rotation.x = swing2 * 0.25 * (1 - av.deathT) - 0.15 - av.crouchT * 0.2;
    av.armR.rotation.x = swing * 0.25 * (1 - av.deathT) - 0.15 - av.crouchT * 0.2;

    // Tête : suit partiellement le pitch.
    av.head.rotation.x = -s.pitch * 0.35 * (1 - av.deathT);

    // Mort : bascule complète du corps vers l'arrière + léger affaissement.
    av.body.rotation.x = -av.deathT * (Math.PI / 2) * 0.92;
    av.body.position.y = av.deathT * 0.18;
    av.nameSprite.visible = s.hp > 0;
  }

  /** Flash de bouche d'un distant (à l'arrivée d'un ev kill/damage). */
  flashAt(id: number): void {
    const av = this.avatars.get(id);
    if (av) {
      // Date.now() : même horloge que le nowMs comparé dans update() —
      // performance.now() (uptime page) rendait le flash invisible.
      av.flashUntil = Date.now() + FLASH_MS;
    }
  }

  /** Position monde de la pointe du canon d'un distant (tracantes). */
  muzzleWorld(id: number, out: THREE.Vector3): boolean {
    const av = this.avatars.get(id);
    if (!av) return false;
    av.muzzle.getWorldPosition(out);
    return true;
  }

  /** Reconstruit l'arme de tous les avatars (mods de modèles appliqués). */
  refreshGuns(): void {
    for (const av of this.avatars.values()) {
      this.rebuildGun(av, av.weaponId);
    }
  }

  /** Masque les avatars trop longtemps sans état. */
  cullStale(nowMs: number): void {
    for (const av of this.avatars.values()) {
      if (nowMs - av.lastSeenAt > STALE_MS) {
        av.root.visible = false;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Construction
  // --------------------------------------------------------------------------

  private buildAvatar(info: PlayerInfo): Avatar {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const cloth = getClothMat();
    const vest = getVestMat();
    const gear = getGearMat();
    const accent = getAccentMat(info.team);

    // ---- Hanches + jambes articulées ----
    const hips = new THREE.Group();
    hips.position.y = 0.88;
    body.add(hips);
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.22), cloth);
    pelvis.castShadow = true;
    hips.add(pelvis);

    const mkLeg = (side: number): THREE.Group => {
      const leg = new THREE.Group();
      leg.position.set(side * 0.11, 0, 0);
      hips.add(leg);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.32, 3, 8), cloth);
      thigh.position.y = -0.26;
      thigh.castShadow = true;
      leg.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 3, 8), cloth);
      shin.position.y = -0.62;
      shin.castShadow = true;
      leg.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.24), gear);
      boot.position.set(0, -0.84, -0.04);
      boot.castShadow = true;
      leg.add(boot);
      const knee = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), gear);
      knee.position.set(0, -0.48, -0.07);
      leg.add(knee);
      return leg;
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);

    // ---- Torse (pivot pitch) ----
    const torso = new THREE.Group();
    torso.position.y = 0.95;
    body.add(torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.34, 4, 10), cloth);
    chest.position.y = 0.32;
    chest.castShadow = true;
    torso.add(chest);
    const vestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.36, 0.28), vest);
    vestMesh.position.y = 0.34;
    vestMesh.castShadow = true;
    torso.add(vestMesh);
    // Bandes d'épaule lumineuses (équipe).
    const stripeGeo = new THREE.BoxGeometry(0.1, 0.03, 0.3);
    for (const dx of [-0.19, 0.19]) {
      const stripe = new THREE.Mesh(stripeGeo, accent);
      stripe.position.set(dx, 0.53, 0);
      torso.add(stripe);
    }
    // Sac à dos + pochettes.
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.14), vest);
    pack.position.set(0, 0.34, 0.2);
    torso.add(pack);
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.06), gear);
    pouch.position.set(0.12, 0.2, -0.17);
    torso.add(pouch);

    // ---- Bras (groupes à l'épaule, tenant l'arme vers -Z) ----
    const mkArm = (side: number): THREE.Group => {
      const arm = new THREE.Group();
      arm.position.set(side * 0.25, 0.48, 0);
      torso.add(arm);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.24, 3, 8), cloth);
      upper.position.y = -0.16;
      upper.castShadow = true;
      arm.add(upper);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 3, 8), cloth);
      fore.position.set(side * -0.03, -0.32, -0.14);
      fore.rotation.x = -1.1;
      fore.castShadow = true;
      arm.add(fore);
      return arm;
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);
    // Orientation de base : bras vers l'arme (devant la poitrine).
    armL.rotation.set(-0.5, 0.5, 0.25);
    armR.rotation.set(-0.5, -0.35, -0.25);

    // ---- Tête : casque + visière ----
    const head = new THREE.Group();
    head.position.y = 0.62;
    torso.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), cloth);
    skull.castShadow = true;
    head.add(skull);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), gear);
    helmet.position.y = 0.02;
    helmet.castShadow = true;
    head.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.03), getVisorMat(info.team));
    visor.position.set(0, 0.01, -0.12);
    head.add(visor);

    // ---- Arme + pointe + flash ----
    const gun = new THREE.Group();
    gun.position.set(0.06, 0.28, -0.32);
    torso.add(gun);
    const muzzle = new THREE.Object3D();
    gun.add(muzzle);
    const flashMat = new THREE.MeshBasicMaterial({
      map: getRemoteMuzzleTex(),
      color: '#FFD9A0',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), flashMat);
    flash.visible = false;
    gun.add(flash);

    // ---- Pseudo ----
    const nameSprite = makeNameSprite(info.name, info.team);
    nameSprite.position.y = 2.1;
    root.add(nameSprite);

    this.scene.add(root);

    const av: Avatar = {
      root,
      body,
      hips,
      legL,
      legR,
      torso,
      armL,
      armR,
      head,
      gun,
      muzzle,
      flash,
      nameSprite,
      team: info.team,
      classId: info.classId,
      weaponId: weaponForSlot(info.classId, 0),
      walkPhase: Math.random() * 6,
      speed: 0,
      prevX: 0,
      prevZ: 0,
      crouchT: 0,
      deathT: 0,
      idleT: Math.random() * 6,
      flashUntil: 0,
      lastSeenAt: 0,
    };
    this.rebuildGun(av, av.weaponId);
    return av;
  }

  private rebuildGun(av: Avatar, wid: WeaponId): void {
    av.weaponId = wid;
    // Retire l'ancien modèle.
    for (const child of [...av.gun.children]) {
      if (child === av.muzzle || child === av.flash) continue;
      av.gun.remove(child);
    }
    // Placeholder simple immédiat.
    const { gun, muzzleLocal } = buildGunModel(wid);
    av.gun.add(gun);
    av.muzzle.position.copy(muzzleLocal);
    av.flash.position.copy(muzzleLocal);
    av.flash.position.z -= 0.08;
    // Puis le VRAI modèle GLB dès qu'il arrive (version FUSIONNÉE : 1-3 meshes
    // par arme — 16 joueurs × 82 nœuds du M21 sinon injouable en draw calls).
    void loadWeaponModel(wid).then((n) => {
      if (n === null || av.weaponId !== wid) return;
      for (const child of [...av.gun.children]) {
        if (child === av.muzzle || child === av.flash) continue;
        av.gun.remove(child);
      }
      const m = mergedWeapon(n);
      av.gun.add(m.root);
      av.muzzle.position.copy(m.muzzle.position);
      av.flash.position.copy(m.muzzle.position);
      av.flash.position.z -= 0.1;
    });
  }

  private destroyAvatar(id: number): void {
    const av = this.avatars.get(id);
    if (!av) return;
    this.scene.remove(av.root);
    av.root.traverse((o) => {
      // Les géométries d'armes fusionnées sont PARTAGÉES (cache mergedWeapon).
      if (o instanceof THREE.Mesh && !o.userData.sharedGeom) o.geometry.dispose();
    });
    const spriteMat = av.nameSprite.material as THREE.SpriteMaterial;
    spriteMat.map?.dispose();
    spriteMat.dispose();
    this.avatars.delete(id);
  }
}
