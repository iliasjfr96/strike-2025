// ============================================================================
// STRIKE 2025 — Interpolation.ts
// Buffer d'interpolation des entités distantes (snapshots SNAP_RATE=30 Hz).
// La timeline est celle des TICKS SERVEUR (at = tick × 33,3 ms) — immunisée
// contre le jitter de réception réseau ; GameClient maintient une horloge de
// rendu qui glisse vers `dernierTick - INTERP_DELAY_MS`. Lerp des positions +
// interpolation angulaire (plus court chemin) de yaw/pitch entre les deux
// états encadrants ; au-delà du dernier état connu : extrapolation linéaire
// BORNÉE (EXTRAP_MAX_MS) sur la vitesse des deux derniers états, puis clamp.
// ============================================================================

import type { PlayerSnapshot, Stance, WeaponSlot } from '../../shared/protocol';

export interface InterpState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  stance: Stance;
  hp: number;
  weaponSlot: WeaponSlot;
  streakMask: number;
  /** Temps serveur (ms, tick × 1000/TICK_RATE) du snapshot porteur. */
  at: number;
}

/** Nombre max d'états conservés par entité (≈ 0,8 s à 30 Hz). */
const MAX_BUFFER = 24;
/** Extrapolation max au-delà du dernier état connu (ms). */
const EXTRAP_MAX_MS = 120;
/** Vitesse max vraisemblable pour extrapoler (m/ms) — au-delà c'est un
 *  téléport (respawn) : on n'extrapole pas à travers. 12 m/s > sprint 7. */
const EXTRAP_MAX_SPEED = 0.012;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Interpolation {
  private readonly buffers = new Map<number, InterpState[]>();

  clear(): void {
    this.buffers.clear();
  }

  remove(id: number): void {
    this.buffers.delete(id);
  }

  /** Enregistre l'état d'un joueur distant à la réception d'un snapshot. */
  push(snap: PlayerSnapshot, at: number): void {
    const id = snap[0];
    let buf = this.buffers.get(id);
    if (!buf) {
      buf = [];
      this.buffers.set(id, buf);
    }
    buf.push({
      x: snap[1],
      y: snap[2],
      z: snap[3],
      yaw: snap[4],
      pitch: snap[5],
      stance: snap[6],
      hp: snap[7],
      weaponSlot: snap[8],
      streakMask: snap[9],
      at,
    });
    if (buf.length > MAX_BUFFER) {
      buf.splice(0, buf.length - MAX_BUFFER);
    }
  }

  /** Dernier état brut connu (radar, fx). null si inconnu. */
  latest(id: number): InterpState | null {
    const buf = this.buffers.get(id);
    return buf && buf.length > 0 ? buf[buf.length - 1] : null;
  }

  /**
   * État interpolé au temps de rendu `renderT` (timeline serveur, DÉJÀ
   * retardé de INTERP_DELAY_MS par l'appelant). Écrit le résultat dans `out`
   * (zéro allocation). Retourne false si l'entité est inconnue.
   */
  sample(id: number, renderT: number, out: InterpState): boolean {
    const buf = this.buffers.get(id);
    if (!buf || buf.length === 0) return false;

    const last = buf[buf.length - 1];
    if (renderT >= last.at) {
      copyState(out, last);
      // Extrapolation linéaire bornée sur la vitesse des 2 derniers états
      // (évite le gel-puis-saut quand un snapshot arrive en retard).
      const prev = buf.length >= 2 ? buf[buf.length - 2] : null;
      if (prev && last.at > prev.at) {
        const ext = Math.min(renderT - last.at, EXTRAP_MAX_MS);
        if (ext > 0) {
          const span = last.at - prev.at;
          const dx = last.x - prev.x;
          const dy = last.y - prev.y;
          const dz = last.z - prev.z;
          // Garde de vraisemblance : un segment plus rapide que EXTRAP_MAX_SPEED
          // est un téléport (respawn) — on n'extrapole pas à travers.
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist <= EXTRAP_MAX_SPEED * span) {
            const inv = 1 / span;
            out.x = last.x + dx * inv * ext;
            out.y = last.y + dy * inv * ext;
            out.z = last.z + dz * inv * ext;
            // yaw/pitch : pas d'extrapolation (les angles tournent vite et mal).
          }
        }
      }
      return true;
    }
    const first = buf[0];
    if (renderT <= first.at) {
      copyState(out, first);
      return true;
    }
    // Recherche du couple encadrant (buffer trié par `at` croissant — les
    // snapshots arrivent dans l'ordre).
    for (let i = buf.length - 2; i >= 0; i--) {
      const a = buf[i];
      if (a.at <= renderT) {
        const b = buf[i + 1];
        const span = b.at - a.at;
        const t = span > 0 ? (renderT - a.at) / span : 1;
        out.x = a.x + (b.x - a.x) * t;
        out.y = a.y + (b.y - a.y) * t;
        out.z = a.z + (b.z - a.z) * t;
        out.yaw = lerpAngle(a.yaw, b.yaw, t);
        out.pitch = a.pitch + (b.pitch - a.pitch) * t;
        // Champs discrets : prendre le plus récent.
        out.stance = b.stance;
        out.hp = b.hp;
        out.weaponSlot = b.weaponSlot;
        out.streakMask = b.streakMask;
        out.at = b.at;
        return true;
      }
    }
    copyState(out, first);
    return true;
  }
}

function copyState(out: InterpState, s: InterpState): void {
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.yaw = s.yaw;
  out.pitch = s.pitch;
  out.stance = s.stance;
  out.hp = s.hp;
  out.weaponSlot = s.weaponSlot;
  out.streakMask = s.streakMask;
  out.at = s.at;
}
