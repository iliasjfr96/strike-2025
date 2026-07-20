// ============================================================================
// STRIKE 2025 — server/History.ts
// Ring buffer des états passés d'un joueur (1 état par tick serveur) utilisé
// par la lag compensation : au moment d'un tir, le serveur rembobine les
// positions des adversaires de rtt/2 + LAG_COMP_MARGIN_MS (clampé à
// HISTORY_MAX_AGE_MS) avant le raycast.
// ============================================================================

import { HISTORY_SIZE } from '../src/shared/protocol.js';

/** Un état historique : position des pieds + hauteur (posture) à un instant. */
export interface HistState {
  /** Timestamp serveur (ms, Date.now()). */
  at: number;
  x: number;
  y: number;
  z: number;
  /** Hauteur courante du corps (dépend du crouch). */
  height: number;
}

export class History {
  private buf: HistState[] = [];

  /** Enregistre un état (appelé 1 fois par tick). Capacité HISTORY_SIZE. */
  push(s: HistState): void {
    this.buf.push(s);
    if (this.buf.length > HISTORY_SIZE) this.buf.shift();
  }

  /** Vide l'historique (respawn / téléportation : ne jamais rembobiner
   *  vers la position de mort). */
  clear(): void {
    this.buf.length = 0;
  }

  /**
   * État le plus proche de l'instant `at`. À distance égale, préfère un état
   * passé (<= at) pour ne jamais avancer un adversaire dans le futur.
   * Retourne null si l'historique est vide (l'appelant utilise la position
   * courante).
   */
  sample(at: number): HistState | null {
    let best: HistState | null = null;
    for (const s of this.buf) {
      if (best === null) {
        best = s;
        continue;
      }
      const d = Math.abs(s.at - at);
      const db = Math.abs(best.at - at);
      if (d < db || (d === db && s.at <= at && best.at > at)) {
        best = s;
      }
    }
    return best;
  }
}
