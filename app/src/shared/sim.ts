// ============================================================================
// STRIKE 2025 — sim.ts
// Simulation physique PARTAGÉE : tourne à l'identique côté client (prédiction)
// et côté serveur (autorité). TypeScript pur, zéro dépendance externe
// (seul import : ./protocol pour les constantes de netcode).
//
// Conventions :
//  - Repère : X = est, Y = haut, Z = sud (Three.js standard, main droite).
//  - pos d'un joueur = position des PIEDS (bas de la capsule/AABB).
//  - yaw = 0 -> regarde vers -Z ; forward = (-sin(yaw), 0, -cos(yaw)).
//    Regarder vers +X (est) => yaw = -PI/2. Vers +X... voir forwardFromYaw.
//  - pitch > 0 -> regarde vers le haut. Clampé à ±PITCH_LIMIT_RAD.
//  - Le sol implicite est le plan y = 0 (les AABB de la map ne l'incluent pas).
// ============================================================================

import { DT_MAX, PITCH_LIMIT_DEG } from './protocol';

// ----------------------------------------------------------------------------
// Types géométriques
// ----------------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Axis-Aligned Bounding Box (toute la géométrie de collision du jeu). */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function aabb(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): AABB {
  return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) };
}

/** Construit un AABB depuis son centre XZ, sa base Y et ses dimensions. */
export function aabbFromBase(
  cx: number, baseY: number, cz: number,
  sizeX: number, sizeY: number, sizeZ: number,
): AABB {
  return aabb(
    cx - sizeX / 2, baseY, cz - sizeZ / 2,
    cx + sizeX / 2, baseY + sizeY, cz + sizeZ / 2,
  );
}

export function aabbContains(b: AABB, p: Vec3): boolean {
  return (
    p.x >= b.min.x && p.x <= b.max.x &&
    p.y >= b.min.y && p.y <= b.max.y &&
    p.z >= b.min.z && p.z <= b.max.z
  );
}

export function aabbOverlaps(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

// ----------------------------------------------------------------------------
// Constantes de mouvement (imposées par le game design)
// ----------------------------------------------------------------------------

export const SPEED_WALK = 5.2;    // m/s
export const SPEED_SPRINT = 7.0;  // m/s (avant uniquement, pas ADS, pas accroupi)
export const SPEED_CROUCH = 2.6;  // m/s
export const SPEED_ADS = 3.2;     // m/s (visée épaule/lunette)
export const JUMP_VELOCITY = 7.5; // m/s
export const GRAVITY = 22;        // m/s²

/** Demi-largeur du joueur (AABB 0.6 x height x 0.6). */
export const PLAYER_HALF_WIDTH = 0.3;
export const PLAYER_WIDTH = PLAYER_HALF_WIDTH * 2; // 0.6 m
export const HEIGHT_STAND = 1.8;   // m
export const HEIGHT_CROUCH = 1.2;  // m
export const EYE_STAND = 1.62;     // m au-dessus des pieds
export const EYE_CROUCH = 1.05;    // m
/** Vitesse de transition debout <-> accroupi (m/s sur la hauteur). */
export const HEIGHT_LERP_RATE = 10;
/** Hauteur max d'une marche franchissable sans sauter (rampes = escaliers). */
export const STEP_HEIGHT = 0.45;
/** Accélération horizontale au sol (coefficient d'approche exponentielle /s). */
export const GROUND_ACCEL = 12;
/** Contrôle aérien (bien plus faible qu'au sol). */
export const AIR_ACCEL = 2.5;
/** Hauteur de la « tête » (zone critique) mesurée depuis le haut du corps. */
export const HEAD_HEIGHT = 0.35;

export const PITCH_LIMIT_RAD = (PITCH_LIMIT_DEG * Math.PI) / 180;

/** Enveloppe ABSOLUE du monde jouable (filet de sécurité, PAS le gameplay :
 *  les murs bloquent avant — ces bornes sont légèrement à l'intérieur de
 *  l'épaisseur des murs de map.ts/FLAT_WALLS et ne mordent jamais en jeu
 *  normal). Elles garantissent qu'aucun trou de géométrie (map éditée,
 *  collider supprimé, coin oublié) ne laisse un corps sortir de la map. */
export const WORLD_X_MIN = -32.3;
export const WORLD_X_MAX = 34.7;
export const WORLD_Z_MIN = -48.3;
export const WORLD_Z_MAX = 48.3;

// ----------------------------------------------------------------------------
// Entrées joueur (bitmask) — reflété dans protocol.InputMsg.keys
// ----------------------------------------------------------------------------

export const KEY_FORWARD = 1 << 0; // Z / W
export const KEY_BACK = 1 << 1;    // S
export const KEY_LEFT = 1 << 2;    // Q / A
export const KEY_RIGHT = 1 << 3;   // D
export const KEY_JUMP = 1 << 4;    // Espace
export const KEY_CROUCH = 1 << 5;  // Ctrl / C
export const KEY_SPRINT = 1 << 6;  // Shift
export const KEY_ADS = 1 << 7;     // Clic droit

export interface PlayerInput {
  yaw: number;   // radians (déjà clampé côté client)
  pitch: number; // radians
  keys: number;  // bitmask KEY_*
}

// ----------------------------------------------------------------------------
// État du corps simulé
// ----------------------------------------------------------------------------

export type Stance = 0 | 1; // 0 = debout, 1 = accroupi (miroir de protocol.Stance)

export interface BodyState {
  /** Position des pieds. */
  pos: Vec3;
  /** Vélocité (m/s). */
  vel: Vec3;
  /** Hauteur courante (interpole entre HEIGHT_CROUCH et HEIGHT_STAND). */
  height: number;
  /** Posture logique (cible) : 0 debout, 1 accroupi. */
  stance: Stance;
  /** Vrai si au sol (plan y=0 ou sommet d'un AABB). */
  onGround: boolean;
}

export function makeBody(x: number, y: number, z: number): BodyState {
  return {
    pos: vec3(x, y, z),
    vel: vec3(0, 0, 0),
    height: HEIGHT_STAND,
    stance: 0,
    onGround: true,
  };
}

/** AABB du joueur (pieds pos.y, sommet pos.y + height). */
export function playerAABB(pos: Vec3, height: number): AABB {
  return aabb(
    pos.x - PLAYER_HALF_WIDTH, pos.y, pos.z - PLAYER_HALF_WIDTH,
    pos.x + PLAYER_HALF_WIDTH, pos.y + height, pos.z + PLAYER_HALF_WIDTH,
  );
}

/** Hauteur des yeux en fonction de la hauteur courante (accroupi intermédiaire). */
export function eyeHeight(height: number): number {
  const t = (height - HEIGHT_CROUCH) / (HEIGHT_STAND - HEIGHT_CROUCH);
  return EYE_CROUCH + (EYE_STAND - EYE_CROUCH) * Math.min(1, Math.max(0, t));
}

/** Position de l'œil (origine des tirs / caméra). */
export function eyePos(body: BodyState): Vec3 {
  return vec3(body.pos.x, body.pos.y + eyeHeight(body.height), body.pos.z);
}

// ----------------------------------------------------------------------------
// Helpers d'orientation
// ----------------------------------------------------------------------------

export function clampPitch(pitch: number): number {
  if (pitch > PITCH_LIMIT_RAD) return PITCH_LIMIT_RAD;
  if (pitch < -PITCH_LIMIT_RAD) return -PITCH_LIMIT_RAD;
  return pitch;
}

/** Direction horizontale de visée : yaw=0 -> -Z, yaw=-PI/2 -> +X (est). */
export function forwardFromYaw(yaw: number): Vec3 {
  return vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Direction 3D complète (pour les tirs). pitch > 0 monte. */
export function dirFromYawPitch(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return vec3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

// ----------------------------------------------------------------------------
// stepBody — un pas de simulation (identique client & serveur)
// ----------------------------------------------------------------------------

const EPS = 1e-4;

/** Teste si l'AABB du joueur à `pos` (hauteur `height`) est libre. */
function freeAt(pos: Vec3, height: number, colliders: AABB[]): boolean {
  const box = playerAABB(pos, height);
  for (let i = 0; i < colliders.length; i++) {
    if (aabbOverlaps(box, colliders[i])) return false;
  }
  return true;
}

/**
 * Avance le corps de `dt` secondes.
 * - dt est clampé à DT_MAX (50 ms) : jamais de tunneling ni de spiral of death.
 * - Ordre de résolution : X (avec step-up) -> Z (avec step-up) -> Y -> sol y=0.
 * - Le step-up (<= STEP_HEIGHT) rend les rampes-escaliers praticables.
 * - `speedMult` (défaut 1) = mobilité de l'arme en main (weapons.ts) : le
 *   client ET le serveur passent la même valeur pour une prédiction exacte.
 */
export function stepBody(
  body: BodyState,
  input: PlayerInput,
  colliders: AABB[],
  dt: number,
  speedMult = 1,
): void {
  if (!(dt > 0)) return;
  if (dt > DT_MAX) dt = DT_MAX;

  // ---- 1. Posture (crouch / stand) -----------------------------------------
  const wantCrouch = (input.keys & KEY_CROUCH) !== 0;
  if (wantCrouch) {
    body.stance = 1;
  } else if (body.stance === 1) {
    // On ne se relève que s'il y a de la place au-dessus.
    if (freeAt(body.pos, HEIGHT_STAND, colliders)) {
      body.stance = 0;
    }
  }
  const targetHeight = body.stance === 1 ? HEIGHT_CROUCH : HEIGHT_STAND;
  if (body.height !== targetHeight) {
    const dh = HEIGHT_LERP_RATE * dt;
    if (body.height < targetHeight) {
      body.height = Math.min(targetHeight, body.height + dh);
    } else {
      // Accroupissement : les pieds restent au sol, le sommet descend.
      body.height = Math.max(targetHeight, body.height - dh);
    }
  }

  // ---- 2. Vitesse horizontale souhaitée ------------------------------------
  const f = forwardFromYaw(input.yaw);
  const r = vec3(-f.z, 0, f.x); // droite = forward x up... (main droite)
  let wx = 0;
  let wz = 0;
  if (input.keys & KEY_FORWARD) { wx += f.x; wz += f.z; }
  if (input.keys & KEY_BACK) { wx -= f.x; wz -= f.z; }
  if (input.keys & KEY_RIGHT) { wx += r.x; wz += r.z; }
  if (input.keys & KEY_LEFT) { wx -= r.x; wz -= r.z; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  const ads = (input.keys & KEY_ADS) !== 0;
  const sprinting =
    (input.keys & KEY_SPRINT) !== 0 &&
    !ads &&
    body.stance === 0 &&
    (input.keys & KEY_FORWARD) !== 0 &&
    (input.keys & KEY_BACK) === 0;

  let speed = SPEED_WALK;
  if (body.stance === 1) speed = SPEED_CROUCH;
  else if (ads) speed = SPEED_ADS;
  else if (sprinting) speed = SPEED_SPRINT;

  const wishX = wx * speed;
  const wishZ = wz * speed;

  // Approche exponentielle (friction + accélération fondues, stable en dt).
  const accel = body.onGround ? GROUND_ACCEL : AIR_ACCEL;
  const k = Math.min(1, accel * dt);
  body.vel.x += (wishX - body.vel.x) * k;
  body.vel.z += (wishZ - body.vel.z) * k;

  // ---- 3. Saut + gravité ----------------------------------------------------
  if (body.onGround && (input.keys & KEY_JUMP) !== 0) {
    body.vel.y = JUMP_VELOCITY;
    body.onGround = false;
  }
  body.vel.y -= GRAVITY * dt;

  // ---- 4. Déplacement X puis Z (résolution par axe + step-up) ---------------
  moveAxis(body, colliders, 0, body.vel.x * dt);
  moveAxis(body, colliders, 2, body.vel.z * dt);

  // ---- 5. Déplacement Y ------------------------------------------------------
  body.onGround = false;
  body.pos.y += body.vel.y * dt;
  let box = playerAABB(body.pos, body.height);
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!aabbOverlaps(box, c)) continue;
    if (body.vel.y <= 0) {
      // Atterrissage sur le dessus du collider.
      body.pos.y = c.max.y + EPS;
      body.vel.y = 0;
      body.onGround = true;
    } else {
      // Tête contre le plafond.
      body.pos.y = c.min.y - body.height - EPS;
      body.vel.y = 0;
    }
    box = playerAABB(body.pos, body.height);
  }

  // ---- 6. Sol implicite y = 0 ------------------------------------------------
  if (body.pos.y <= 0) {
    body.pos.y = 0;
    if (body.vel.y < 0) body.vel.y = 0;
    body.onGround = true;
  }

  // ---- 7. Enveloppe du monde (filet de sécurité, jamais atteinte en jeu
  //         normal — voir WORLD_*) ---------------------------------------------
  if (body.pos.x < WORLD_X_MIN) { body.pos.x = WORLD_X_MIN; body.vel.x = 0; }
  else if (body.pos.x > WORLD_X_MAX) { body.pos.x = WORLD_X_MAX; body.vel.x = 0; }
  if (body.pos.z < WORLD_Z_MIN) { body.pos.z = WORLD_Z_MIN; body.vel.z = 0; }
  else if (body.pos.z > WORLD_Z_MAX) { body.pos.z = WORLD_Z_MAX; body.vel.z = 0; }
}

/** Variante de freeAt pour le step-up : ignore les obstacles dont le dessus
 *  est à <= STEP_HEIGHT au-dessus des nouveaux pieds (franchissables ensuite)
 *  ou déjà sous les pieds ; exige le reste libre. */
function freeAtStep(pos: Vec3, height: number, colliders: AABB[], feetY: number): boolean {
  const box = playerAABB(pos, height);
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const rel = c.max.y - feetY;
    if (rel <= STEP_HEIGHT && rel > -1) continue;
    if (aabbOverlaps(box, c)) return false;
  }
  return true;
}

/** Déplacement sur un axe (0 = x, 2 = z) avec blocage et step-up. */
function moveAxis(
  body: BodyState,
  colliders: AABB[],
  axis: 0 | 2,
  delta: number,
): void {
  if (delta === 0) return;
  if (axis === 0) body.pos.x += delta;
  else body.pos.z += delta;

  let box = playerAABB(body.pos, body.height);
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!aabbOverlaps(box, c)) continue;

    // Step-up : obstacle bas franchissable si on est au sol et tête libre.
    // La montée d'un escalier est RÉCURSIVE : la capsule (0.6 m) chevauche
    // naturellement la marche suivante en montant — on ignore donc les
    // obstacles dont le dessus reste à <= STEP_HEIGHT des nouveaux pieds
    // (ils seront franchis au(x) frame(s) suivante(s)), tout en exigeant
    // la tête libre de tout obstacle plus haut (murs, caisses...).
    const stepUp = c.max.y - body.pos.y;
    if (body.onGround && stepUp > 0 && stepUp <= STEP_HEIGHT) {
      const raised = vec3(body.pos.x, c.max.y + EPS, body.pos.z);
      if (freeAtStep(raised, body.height, colliders, raised.y)) {
        body.pos.y = raised.y;
        box = playerAABB(body.pos, body.height);
        continue;
      }
    }

    // Blocage : on repousse le corps contre la face du collider.
    if (axis === 0) {
      body.pos.x = delta > 0 ? c.min.x - PLAYER_HALF_WIDTH - EPS : c.max.x + PLAYER_HALF_WIDTH + EPS;
      body.vel.x = 0;
    } else {
      body.pos.z = delta > 0 ? c.min.z - PLAYER_HALF_WIDTH - EPS : c.max.z + PLAYER_HALF_WIDTH + EPS;
      body.vel.z = 0;
    }
    box = playerAABB(body.pos, body.height);
  }
}

// ----------------------------------------------------------------------------
// Raycasts (hitscan)
// ----------------------------------------------------------------------------

export interface RayHitBox {
  /** Index de la box dans le tableau `boxes`. */
  index: number;
  box: AABB;
  /** Distance le long du rayon (m). */
  dist: number;
  /** Point d'impact. */
  point: Vec3;
  /** Normale de la face touchée (unitaire, opposee à dir). */
  normal: Vec3;
}

/**
 * Raycast contre un tableau d'AABB (slab method). `dir` DOIT être normalisée.
 * Retourne l'impact le plus proche à distance <= maxDist, ou null.
 * Une box contenant l'origine est IGNORÉE (tir depuis l'intérieur d'un
 * collider = pas d'auto-blocage).
 */
export function raycastAABBs(
  origin: Vec3,
  dir: Vec3,
  boxes: AABB[],
  maxDist: number,
): RayHitBox | null {
  let best: RayHitBox | null = null;
  let bestDist = maxDist;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const hit = slab(b, origin, dir);
    if (hit === null) continue;
    const [tmin] = hit;
    if (tmin < 0) continue; // origine dans la box -> ignorée
    if (tmin >= bestDist) continue;
    bestDist = tmin;
    best = {
      index: i,
      box: b,
      dist: tmin,
      point: vec3(
        origin.x + dir.x * tmin,
        origin.y + dir.y * tmin,
        origin.z + dir.z * tmin,
      ),
      normal: slabNormal(b, origin, dir),
    };
  }
  return best;
}

/** Intersection rayon/AABB : retourne [tmin, tmax] ou null. */
function slab(b: AABB, o: Vec3, d: Vec3): [number, number] | null {
  let tmin = -Infinity;
  let tmax = Infinity;

  // Axe X
  if (Math.abs(d.x) < 1e-9) {
    if (o.x < b.min.x || o.x > b.max.x) return null;
  } else {
    let t1 = (b.min.x - o.x) / d.x;
    let t2 = (b.max.x - o.x) / d.x;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Axe Y
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < b.min.y || o.y > b.max.y) return null;
  } else {
    let t1 = (b.min.y - o.y) / d.y;
    let t2 = (b.max.y - o.y) / d.y;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Axe Z
  if (Math.abs(d.z) < 1e-9) {
    if (o.z < b.min.z || o.z > b.max.z) return null;
  } else {
    let t1 = (b.min.z - o.z) / d.z;
    let t2 = (b.max.z - o.z) / d.z;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return [tmin, tmax];
}

/** Normale de la face d'entrée (axe dominant de tmin). */
function slabNormal(b: AABB, o: Vec3, d: Vec3): Vec3 {
  const candidates: { t: number; n: Vec3 }[] = [];
  const push = (t: number, nx: number, ny: number, nz: number) => {
    if (isFinite(t)) candidates.push({ t, n: vec3(nx, ny, nz) });
  };
  if (Math.abs(d.x) >= 1e-9) {
    push((b.min.x - o.x) / d.x, d.x > 0 ? -1 : 1, 0, 0);
    push((b.max.x - o.x) / d.x, d.x > 0 ? -1 : 1, 0, 0);
  }
  if (Math.abs(d.y) >= 1e-9) {
    push((b.min.y - o.y) / d.y, 0, d.y > 0 ? -1 : 1, 0);
    push((b.max.y - o.y) / d.y, 0, d.y > 0 ? -1 : 1, 0);
  }
  if (Math.abs(d.z) >= 1e-9) {
    push((b.min.z - o.z) / d.z, 0, 0, d.z > 0 ? -1 : 1);
    push((b.max.z - o.z) / d.z, 0, 0, d.z > 0 ? -1 : 1);
  }
  let bestT = -Infinity;
  let bestN = vec3(0, 1, 0);
  for (const c of candidates) {
    if (c.t > bestT && c.t >= 0) { bestT = c.t; bestN = c.n; }
  }
  return bestN;
}

// ----------------------------------------------------------------------------
// Raycast contre les joueurs (hitbox AABB + zone de tête)
// ----------------------------------------------------------------------------

export interface PlayerTarget {
  id: number;
  /** AABB du corps (pieds -> tête, posture courante). Utiliser playerAABB(). */
  box: AABB;
}

export interface RayHitPlayer {
  id: number;
  dist: number;
  point: Vec3;
  /** Vrai si l'impact est dans la zone de tête (>= max.y - HEAD_HEIGHT). */
  isHead: boolean;
}

/**
 * Raycast contre un ensemble de joueurs. Retourne le joueur touché le plus
 * proche (<= maxDist) ou null. Le tireur doit être EXCLU de `targets`
 * par l'appelant. Une box contenant l'origine est ignorée.
 */
export function raycastPlayers(
  origin: Vec3,
  dir: Vec3,
  targets: PlayerTarget[],
  maxDist: number,
): RayHitPlayer | null {
  let best: RayHitPlayer | null = null;
  let bestDist = maxDist;

  for (const t of targets) {
    const hit = slab(t.box, origin, dir);
    if (hit === null) continue;
    const [tmin] = hit;
    if (tmin < 0 || tmin >= bestDist) continue;
    bestDist = tmin;
    const py = origin.y + dir.y * tmin;
    best = {
      id: t.id,
      dist: tmin,
      point: vec3(origin.x + dir.x * tmin, py, origin.z + dir.z * tmin),
      isHead: py >= t.box.max.y - HEAD_HEIGHT,
    };
  }
  return best;
}

/** Dommages après chute de distance (linéaire start->end jusqu'à minMult).
 *  Helper centralisé pour que client (prévisu) et serveur (autorité)
 *  utilisent exactement la même courbe. */
export function damageAtDistance(
  base: number,
  dist: number,
  falloffStart: number,
  falloffEnd: number,
  falloffMinMult: number,
): number {
  if (dist <= falloffStart) return base;
  if (dist >= falloffEnd) return base * falloffMinMult;
  const t = (dist - falloffStart) / (falloffEnd - falloffStart);
  return base * (1 - (1 - falloffMinMult) * t);
}

// ----------------------------------------------------------------------------
// Hypothèses
// ----------------------------------------------------------------------------
// 1. Le « droite » local r = (-f.z, 0, f.x) : avec yaw=0 (regard -Z) on obtient
//    r = (+1, 0, 0) = +X, ce qui correspond bien à la droite de l'écran.
// 2. Friction/accélération : approche exponentielle (k = min(1, accel*dt)) au
//    lieu d'un modèle Quake : déterministe, stable pour dt variable <= 50 ms,
//    strictement identique client/serveur puisque même code + même dt.
// 3. Le saut est autorisé dès que onGround && KEY_JUMP (auto-hop si la touche
//    reste enfoncée) : choix simple, cohérent entre client et serveur.
// 4. stepBody NE clamp PAS le yaw (inutile : sin/cos périodiques) mais le
//    pitch DOIT être clampé par l'appelant via clampPitch (fait côté client
//    à la capture souris et côté serveur à la réception de l'input).
// 5. Le sol implicite y=0 est traité APRÈS les colliders : un AABB posé au
//    sol (hauteur <= STEP_HEIGHT) est franchissable par step-up, au-delà il
//    bloque ou sert de plateforme (atterrissage géré par la passe Y).
// 6. damageAtDistance est placée ici (et non dans weapons.ts) car c'est une
//    règle de simulation partagée, pas une donnée d'arme.
