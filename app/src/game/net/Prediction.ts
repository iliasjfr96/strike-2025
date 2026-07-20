// ============================================================================
// STRIKE 2025 — Prediction.ts
// Prédiction du joueur local à PAS FIXE (CLIENT_SIM_DT = 1/60 s) : exécute
// stepBody (sim.ts) avec exactement les mêmes paramètres que le serveur.
// Le rendu interpole entre les deux derniers pas (renderPos(alpha)).
//
// Réconciliation EXACTE par ack : chaque snapshot transporte le dernier seq
// d'input intégré par le serveur (PlayerSnapshot[10]). Chaque input local
// enregistre l'état prédit APRÈS son application (pos + vel) :
//   - si la position serveur au seq acké coïncide avec l'état enregistré
//     (< ACK_MATCH_EPS), la prédiction est confirmée -> simple purge, AUCUN
//     replay, aucun à-coup ;
//   - sinon : rewind à l'état serveur (vélocité reprise de l'état enregistré),
//     replay des inputs > ack, puis lissage (offset de rendu qui décroît) si
//     l'écart est < SNAP_THRESHOLD_M, snap sec sinon.
// ============================================================================

import { DT_MAX } from '../../shared/protocol';
import type { PlayerSnapshot } from '../../shared/protocol';
import { MAP_COLLIDERS } from '../../shared/map';
import {
  HEIGHT_STAND,
  makeBody,
  stepBody,
} from '../../shared/sim';
import type { AABB, BodyState, PlayerInput } from '../../shared/sim';

const COLLIDERS = MAP_COLLIDERS as AABB[];

/** Rayon XZ du gabarit joueur pour le test d'appui (moitié de 0.6). */
const FOOT_R = 0.3;

/** Vrai si une position est « au sol » : plan y=0 OU sommet d'un collider à
 *  ±epsilon sous les pieds avec recouvrement XZ (marches arrondies au cm
 *  comprises — les snapshots quantifient y à 0.01). */
function groundedAt(x: number, y: number, z: number): boolean {
  if (y <= 0.001) return true;
  for (const b of COLLIDERS) {
    if (y >= b.max.y - 0.06 && y <= b.max.y + 0.02) {
      if (x + FOOT_R > b.min.x && x - FOOT_R < b.max.x && z + FOOT_R > b.min.z && z - FOOT_R < b.max.z) {
        return true;
      }
    }
  }
  return false;
}

/** Écart max (m) entre prédit et rejoué pour un simple lissage. */
const SNAP_THRESHOLD_M = 0.35;
/** Écart (m) sous lequel la prédiction au seq acké est considérée confirmée. */
const ACK_MATCH_EPS = 0.025;
/** Vitesse d'extinction de l'offset de lissage (/s, approche exponentielle). */
const SMOOTH_RATE = 12;
/** Cap de sécurité sur la file d'inputs (= 3 s à 60 Hz). */
const MAX_PENDING = 180;

export interface PendingInput extends PlayerInput {
  seq: number;
  dt: number;
  /** Date.now() du flush réseau ; 0 tant que non envoyé. */
  sentAt: number;
  /** État prédit APRÈS application de cet input (réconciliation par ack). */
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
}

export class Prediction {
  readonly body: BodyState = makeBody(0, 0, 0);
  yaw = 0;
  pitch = 0;
  /** Mobilité de l'arme en main (5e argument de stepBody — identique serveur). */
  speedMult = 1;

  private pending: PendingInput[] = [];
  private seq = 0;
  /** Dernier seq d'input déjà réconcilié (détection des acks répétés). */
  private lastAckedSeq = -1;
  private smoothX = 0;
  private smoothY = 0;
  private smoothZ = 0;
  /** Position au pas PRÉCÉDENT (interpolation de rendu entre deux pas fixes). */
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;

  /** Repositionne tout (respawn / welcome / nouvelle partie). */
  reset(x: number, y: number, z: number, yaw: number): void {
    this.body.pos.x = x;
    this.body.pos.y = y;
    this.body.pos.z = z;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.body.vel.z = 0;
    this.body.height = HEIGHT_STAND;
    this.body.stance = 0;
    this.body.onGround = y <= 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.pending = [];
    this.lastAckedSeq = -1;
    this.smoothX = 0;
    this.smoothY = 0;
    this.smoothZ = 0;
    this.prevX = x;
    this.prevY = y;
    this.prevZ = z;
  }

  /**
   * Avance la simulation locale d'UN pas fixe et enregistre l'input (envoi
   * réseau batché par GameClient + replay futur). `dt` = CLIENT_SIM_DT.
   */
  step(dt: number, keys: number): PendingInput | null {
    if (!(dt > 0)) return null;
    const cdt = Math.min(dt, DT_MAX);
    // Mémorise l'état d'avant-pas pour l'interpolation de rendu.
    this.prevX = this.body.pos.x;
    this.prevY = this.body.pos.y;
    this.prevZ = this.body.pos.z;
    const input: PendingInput = {
      seq: this.seq++,
      dt: cdt,
      yaw: this.yaw,
      pitch: this.pitch,
      keys,
      sentAt: 0,
      px: 0,
      py: 0,
      pz: 0,
      vx: 0,
      vy: 0,
      vz: 0,
    };
    stepBody(this.body, input, COLLIDERS, cdt, this.speedMult);
    // État post-step : référence exacte pour la réconciliation par ack.
    input.px = this.body.pos.x;
    input.py = this.body.pos.y;
    input.pz = this.body.pos.z;
    input.vx = this.body.vel.x;
    input.vy = this.body.vel.y;
    input.vz = this.body.vel.z;
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) {
      this.pending.splice(0, this.pending.length - MAX_PENDING);
    }
    return input;
  }

  /** Inputs en attente de flush réseau. */
  drainUnsent(): PendingInput[] {
    const out: PendingInput[] = [];
    for (const i of this.pending) {
      if (i.sentAt === 0) out.push(i);
    }
    return out;
  }

  /**
   * Réconciliation à la réception d'un snapshot.
   * @param snap  tuple PlayerSnapshot du joueur local (snap[10] = ack de seq)
   * @param alpha fraction du pas fixe en cours (rendu) — continuité du lissage
   */
  reconcile(snap: PlayerSnapshot, alpha: number): void {
    const sx = snap[1];
    const sy = snap[2];
    const sz = snap[3];
    const stance = snap[6];
    const ack = typeof snap[10] === 'number' ? snap[10] : -1;

    // Position de RENDU courante (avant réconciliation) — référence de
    // continuité visuelle (interpolation de pas incluse).
    const a = Math.min(1, Math.max(0, alpha));
    const renderX = this.prevX + (this.body.pos.x - this.prevX) * a + this.smoothX;
    const renderY = this.prevY + (this.body.pos.y - this.prevY) * a + this.smoothY;
    const renderZ = this.prevZ + (this.body.pos.z - this.prevZ) * a + this.smoothZ;

    // 0. Ack sans information nouvelle : le serveur émet un snapshot à CHAQUE
    // tick, y compris ceux où il n'a consommé aucun input — l'ack se répète
    // alors. Si l'entrée ackée a déjà été purgée par un snapshot précédent
    // (ack < premier pending, ou file vide), la position serveur à ce seq a
    // déjà été validée : ne rien faire (surtout pas un rewind à vélocité
    // nulle qui casserait la course en cours).
    if (
      ack >= 0 &&
      ack <= this.lastAckedSeq &&
      (this.pending.length === 0 || this.pending[0].seq > ack)
    ) {
      return;
    }

    // 1. État prédit enregistré au seq acké (si encore en file).
    let ackIdx = -1;
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i].seq === ack) {
        ackIdx = i;
        break;
      }
      if (this.pending[i].seq > ack) break; // file triée par seq croissant
    }

    if (ackIdx >= 0) {
      const ref = this.pending[ackIdx];
      const dx = sx - ref.px;
      const dy = sy - ref.py;
      const dz = sz - ref.pz;
      const err = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (err < ACK_MATCH_EPS) {
        // Prédiction confirmée : purge, pas de replay, pas d'à-coup.
        // (l'arrondi snapshot est de 1 cm — l'epsilon 2,5 cm l'absorbe)
        this.pending.splice(0, ackIdx + 1);
        this.lastAckedSeq = ack;
        return;
      }
      // Divergence réelle : rewind à l'état serveur, vélocité reprise de
      // l'état enregistré (le snapshot ne transporte pas la vélocité).
      this.body.vel.x = ref.vx;
      this.body.vel.y = ref.vy;
      this.body.vel.z = ref.vz;
      this.pending.splice(0, ackIdx + 1);
    } else {
      // Aucun état enregistré au seq acké (ack très ancien ou -1) : rewind
      // avec vélocité nulle, purge de tout ce qui est <= ack.
      this.body.vel.x = 0;
      this.body.vel.y = 0;
      this.body.vel.z = 0;
      let drop = 0;
      while (drop < this.pending.length && this.pending[drop].seq <= ack) drop++;
      if (drop > 0) this.pending.splice(0, drop);
    }
    this.lastAckedSeq = Math.max(this.lastAckedSeq, ack);

    // 2. Rewind + replay des inputs non encore intégrés par le serveur.
    this.body.pos.x = sx;
    this.body.pos.y = sy;
    this.body.pos.z = sz;
    this.body.stance = stance;
    // height : NE PAS snapper (le serveur lerpe à HEIGHT_LERP_RATE) — la
    // hauteur locale converge naturellement via stepBody pendant le replay.
    // onGround : vrai aussi sur les surfaces surélevées (caisses, passerelles,
    // marches) — sinon le premier input rejoué perd accel sol/saut/step-up.
    this.body.onGround = groundedAt(sx, sy, sz);
    for (const input of this.pending) {
      stepBody(this.body, input, COLLIDERS, input.dt, this.speedMult);
    }
    this.prevX = this.body.pos.x;
    this.prevY = this.body.pos.y;
    this.prevZ = this.body.pos.z;

    // 3. Continuité visuelle : écart rendu-avant vs corps-après.
    const dx = renderX - this.body.pos.x;
    const dy = renderY - this.body.pos.y;
    const dz = renderZ - this.body.pos.z;
    const err = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (err < SNAP_THRESHOLD_M) {
      // Lissage : la position de RENDU reste continue, l'offset décroît.
      this.smoothX = dx;
      this.smoothY = dy;
      this.smoothZ = dz;
    } else {
      // Snap sec : le replay a déjà repositionné le corps.
      this.smoothX = 0;
      this.smoothY = 0;
      this.smoothZ = 0;
    }
  }

  /** Extinction de l'offset de lissage (à appeler à chaque frame de rendu). */
  updateSmoothing(dt: number): void {
    if (this.smoothX === 0 && this.smoothY === 0 && this.smoothZ === 0) return;
    const k = Math.min(1, SMOOTH_RATE * dt);
    this.smoothX -= this.smoothX * k;
    this.smoothY -= this.smoothY * k;
    this.smoothZ -= this.smoothZ * k;
    if (
      Math.abs(this.smoothX) < 1e-4 &&
      Math.abs(this.smoothY) < 1e-4 &&
      Math.abs(this.smoothZ) < 1e-4
    ) {
      this.smoothX = 0;
      this.smoothY = 0;
      this.smoothZ = 0;
    }
  }

  /**
   * Position de rendu : interpolation entre le pas précédent et le pas courant
   * (alpha = accumulateur / CLIENT_SIM_DT) + résidu de lissage.
   */
  renderPos(out: { x: number; y: number; z: number }, alpha = 1): void {
    const a = Math.min(1, Math.max(0, alpha));
    out.x = this.prevX + (this.body.pos.x - this.prevX) * a + this.smoothX;
    out.y = this.prevY + (this.body.pos.y - this.prevY) * a + this.smoothY;
    out.z = this.prevZ + (this.body.pos.z - this.prevZ) * a + this.smoothZ;
  }
}
