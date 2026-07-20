// ============================================================================
// STRIKE 2025 — Effects.ts
// Effets de combat pooled (zéro allocation en régime) : tracantes (fins
// parallélépipèdes additifs qui s'estompent en ~70 ms), impacts (petites
// étincelles au point d'impact des tirs), puff sombre sur joueur touché.
// ============================================================================

import * as THREE from 'three';

const fxTexLoader = new THREE.TextureLoader();
let sparksTex: THREE.Texture | null = null;
let smokeFxTex: THREE.Texture | null = null;
function getSparksTex(): THREE.Texture {
  if (!sparksTex) {
    sparksTex = fxTexLoader.load('./fx-sparks.png');
    sparksTex.colorSpace = THREE.SRGBColorSpace;
  }
  return sparksTex;
}
function getSmokeFxTex(): THREE.Texture {
  if (!smokeFxTex) {
    smokeFxTex = fxTexLoader.load('./fx-smoke.png');
    smokeFxTex.colorSpace = THREE.SRGBColorSpace;
  }
  return smokeFxTex;
}

const MAX_TRACERS = 32;
const TRACER_LIFE_MS = 70;
const MAX_SPARKS = 72;
const SPARK_LIFE = 0.28; // s
const MAX_PUFFS = 20;
const PUFF_LIFE = 0.45; // s
const MAX_CASINGS = 32;
const CASING_LIFE = 1.4; // s
const MAX_DECALS = 24;
const DECAL_LIFE = 9; // s

interface Casing {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  rz: number;
  age: number;
  active: boolean;
}

interface Decal {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  active: boolean;
}

interface Tracer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  until: number;
}

interface Spark {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  active: boolean;
}

interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  active: boolean;
}

export class Effects {
  private readonly scene: THREE.Scene;
  private readonly tracers: Tracer[] = [];
  private tracerCursor = 0;
  private readonly sparks: Spark[] = [];
  private sparkCursor = 0;
  private readonly puffs: Puff[] = [];
  private puffCursor = 0;
  private readonly casings: Casing[] = [];
  private casingCursor = 0;
  private readonly decals: Decal[] = [];
  private decalCursor = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Pool tracantes.
    const tracerGeo = new THREE.BoxGeometry(0.011, 0.011, 1);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#FFD9A0',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, mat, until: 0 });
    }

    // Pool étincelles (sprites texturés fx-sparks.png).
    for (let i = 0; i < MAX_SPARKS; i++) {
      const mat = new THREE.SpriteMaterial({
        map: getSparksTex(),
        color: '#FFC268',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Sprite(mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.sparks.push({ mesh: mesh as unknown as THREE.Mesh, mat: mat as unknown as THREE.MeshBasicMaterial, vx: 0, vy: 0, vz: 0, age: 0, active: false });
    }

    // Pool puffs (fumée texturée teintée sang sombre pour les joueurs touchés).
    for (let i = 0; i < MAX_PUFFS; i++) {
      const mat = new THREE.SpriteMaterial({
        map: getSmokeFxTex(),
        color: '#5A1414',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.puffs.push({ sprite, mat, age: 0, active: false });
    }

    // Pool étuis (laiton) — partagent une géométrie + un matériau.
    const casingGeo = new THREE.BoxGeometry(0.011, 0.011, 0.026);
    const casingMat = new THREE.MeshStandardMaterial({
      color: '#C9A227',
      roughness: 0.3,
      metalness: 0.85,
      envMapIntensity: 1.0,
    });
    for (let i = 0; i < MAX_CASINGS; i++) {
      const mesh = new THREE.Mesh(casingGeo, casingMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.casings.push({ mesh, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, age: 0, active: false });
    }

    // Pool decals d'impact (marques sombres sur surfaces).
    const decalGeo = new THREE.PlaneGeometry(0.09, 0.09);
    for (let i = 0; i < MAX_DECALS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#0B0D10',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const mesh = new THREE.Mesh(decalGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.decals.push({ mesh, mat, age: 0, active: false });
    }
  }

  /** Éjecte un étui (tir local) depuis une position monde + direction droite. */
  ejectCasing(from: THREE.Vector3, rightDir: THREE.Vector3): void {
    const c = this.casings[this.casingCursor];
    this.casingCursor = (this.casingCursor + 1) % MAX_CASINGS;
    c.mesh.position.copy(from);
    c.vx = rightDir.x * (1.2 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.5;
    c.vy = 1.6 + Math.random() * 0.9;
    c.vz = rightDir.z * (1.2 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.5;
    c.rx = (Math.random() - 0.5) * 14;
    c.rz = (Math.random() - 0.5) * 14;
    c.age = 0;
    c.active = true;
    c.mesh.visible = true;
    c.mesh.scale.setScalar(1);
  }

  /** Marque d'impact durable sur une surface (point + normale). */
  impactDecal(point: { x: number; y: number; z: number }, normal?: { x: number; y: number; z: number }): void {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    const n = normal ?? { x: 0, y: 1, z: 0 };
    d.mesh.position.set(point.x + n.x * 0.012, point.y + n.y * 0.012, point.z + n.z * 0.012);
    d.mesh.lookAt(point.x + n.x, point.y + n.y, point.z + n.z);
    d.mesh.rotation.z = Math.random() * Math.PI;
    d.mesh.scale.setScalar(0.7 + Math.random() * 0.7);
    d.age = 0;
    d.active = true;
    d.mesh.visible = true;
    d.mat.opacity = 0.55;
  }

  /** Tracante de `from` à `to` (monde). */
  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.3) return;
    t.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    t.mesh.lookAt(to.x, to.y, to.z);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.mat.opacity = 0.55;
    t.until = performance.now() + TRACER_LIFE_MS;
  }

  /** Étincelles d'impact à un point (normale optionnelle pour orienter le jet). */
  impact(point: { x: number; y: number; z: number }, normal?: { x: number; y: number; z: number }): void {
    const n = normal ?? { x: 0, y: 1, z: 0 };
    const count = 6;
    for (let i = 0; i < count; i++) {
      const s = this.sparks[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
      s.mesh.position.set(point.x, point.y, point.z);
      // Jet aléatoire biaisé le long de la normale.
      const spread = 2.4;
      s.vx = n.x * 2.4 + (Math.random() - 0.5) * spread;
      s.vy = n.y * 2.4 + Math.random() * 1.8;
      s.vz = n.z * 2.4 + (Math.random() - 0.5) * spread;
      s.age = 0;
      s.active = true;
      s.mesh.visible = true;
      s.mat.opacity = 0.95;
      const scale = 0.6 + Math.random() * 0.9;
      s.mesh.scale.set(scale, scale, scale);
    }
  }

  /** Puff sombre sur un joueur touché. */
  bloodPuff(point: { x: number; y: number; z: number }): void {
    const p = this.puffs[this.puffCursor];
    this.puffCursor = (this.puffCursor + 1) % MAX_PUFFS;
    p.sprite.position.set(point.x, point.y, point.z);
    p.sprite.scale.set(0.28, 0.28, 1);
    p.age = 0;
    p.active = true;
    p.sprite.visible = true;
    p.mat.opacity = 0.75;
  }

  /** Avance les effets (fade des tracantes, cinématique des étincelles/puffs). */
  update(nowMs: number, dt: number): void {
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      const remain = t.until - nowMs;
      if (remain <= 0) {
        t.mesh.visible = false;
        t.mat.opacity = 0;
      } else {
        t.mat.opacity = 0.55 * (remain / TRACER_LIFE_MS);
      }
    }
    for (const s of this.sparks) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= SPARK_LIFE) {
        s.active = false;
        s.mesh.visible = false;
        s.mat.opacity = 0;
        continue;
      }
      s.vy -= 9.5 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mat.opacity = 0.95 * (1 - s.age / SPARK_LIFE);
    }
    for (const p of this.puffs) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= PUFF_LIFE) {
        p.active = false;
        p.sprite.visible = false;
        p.mat.opacity = 0;
        continue;
      }
      const t = p.age / PUFF_LIFE;
      const scale = 0.28 + t * 0.75;
      p.sprite.scale.set(scale, scale, 1);
      p.sprite.position.y += dt * 0.5;
      p.mat.opacity = 0.75 * (1 - t);
    }
    // Étuis : gravité + rebond simple + spin + fade final.
    for (const c of this.casings) {
      if (!c.active) continue;
      c.age += dt;
      if (c.age >= CASING_LIFE) {
        c.active = false;
        c.mesh.visible = false;
        continue;
      }
      c.vy -= 12 * dt;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y += c.vy * dt;
      c.mesh.position.z += c.vz * dt;
      if (c.mesh.position.y < 0.02 && c.vy < 0) {
        c.mesh.position.y = 0.02;
        c.vy = -c.vy * 0.28;
        c.vx *= 0.6;
        c.vz *= 0.6;
        c.rx *= 0.5;
        c.rz *= 0.5;
      }
      c.mesh.rotation.x += c.rx * dt;
      c.mesh.rotation.z += c.rz * dt;
      if (c.age > CASING_LIFE - 0.35) {
        c.mesh.scale.setScalar(Math.max(0.01, 1 - (c.age - (CASING_LIFE - 0.35)) / 0.35));
      }
    }
    // Decals : fade sur la fin de vie.
    for (const d of this.decals) {
      if (!d.active) continue;
      d.age += dt;
      if (d.age >= DECAL_LIFE) {
        d.active = false;
        d.mesh.visible = false;
        d.mat.opacity = 0;
        continue;
      }
      if (d.age > DECAL_LIFE - 2) {
        d.mat.opacity = 0.55 * (1 - (d.age - (DECAL_LIFE - 2)) / 2);
      }
    }
  }
}
