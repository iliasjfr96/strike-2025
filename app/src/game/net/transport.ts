// ============================================================================
// STRIKE 2025 — transport.ts
// Interface commune aux transports temps réel du client :
//  - NetClient     : WebSocket (préféré, faible latence)
//  - HttpTransport : secours 100 % HTTP (long-poll + POST) quand un
//                    proxy/hébergeur bloque l'upgrade WebSocket.
// GameClient ne connaît que cette interface.
// ============================================================================

import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export interface TransportCallbacks {
  /** Transport établi (le hello n'a pas encore été envoyé). */
  onOpen(): void;
  /** Message serveur décodé (y compris pong, après mise à jour RTT/offset). */
  onMessage(msg: ServerMsg): void;
  /** Transport fermé. `intentional` = close() appelé par le client. */
  onClose(intentional: boolean): void;
}

export interface Transport {
  /** Ouvre le transport. Idempotent. */
  connect(): void;
  /** Fermeture volontaire. */
  close(): void;
  /** Envoie un message (ignoré si non connecté). */
  send(msg: ClientMsg): void;
  /** Vrai si le transport est utilisable. */
  readonly connected: boolean;
  /** RTT estimé (ms, lissé). 0 tant qu'aucun pong n'est arrivé. */
  readonly rttMs: number;
  /** Offset estimé serveur - local (ms, lissé). */
  readonly serverOffsetMs: number;
  /** Estimation du temps serveur courant (ms epoch). */
  serverNow(): number;
}
