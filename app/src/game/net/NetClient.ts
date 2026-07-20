// ============================================================================
// STRIKE 2025 — NetClient.ts
// WebSocket sur /ws : encode/decode protocol.ts, ping 2 s, estimation de
// l'offset serveur (lissé) + RTT, fermeture propre. Aucune logique de jeu ici
// — GameClient branche ses callbacks.
//
// Robustesse déploiement : derrière un proxy qui sert l'app sous un préfixe
// de chemin (ex. https://hote/apps/strike/), l'URL absolue /ws peut ne pas
// atteindre le conteneur. On essaie donc en séquence :
//   1. <base de la page>/ws   (si la page n'est pas à la racine)
//   2. /ws                    (chemin canonique)
// Chaque tentative a un timeout ; les étapes sont journalisées en console.
//
// NB : ping.c est envoyé en Date.now() (ms epoch local) et non
// performance.now(), afin que serverOffsetMs soit dans le même domaine que
// les timestamps UI du bridge (KillcamInfo.until, FinalResults.returnAt =
// Date.now() local). Le serveur se contente d'échoïter `c` (protocol.ts).
// ============================================================================

import { decodeMsg, encodeMsg, WS_PATH } from '../../shared/protocol';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export interface NetClientCallbacks {
  /** Socket ouvert (le hello n'a pas encore été envoyé). */
  onOpen(): void;
  /** Message serveur décodé (y compris pong, après mise à jour RTT/offset). */
  onMessage(msg: ServerMsg): void;
  /** Socket fermé. `intentional` = close() appelé par le client. */
  onClose(intentional: boolean): void;
}

const PING_INTERVAL_MS = 1000;
/** Timeout d'une tentative de connexion (socket jamais ouvert). */
const ATTEMPT_TIMEOUT_MS = 2500;
/** Lissage exponentiel RTT / offset (0 = pas d'historique). */
const RTT_SMOOTH = 0.6;
const OFFSET_SMOOTH = 0.85;

export class NetClient {
  private readonly cb: NetClientCallbacks;
  /** Salon ciblé (multi-room) — null : salon principal. */
  private readonly room: string | null;
  private ws: WebSocket | null = null;
  private intentionalClose = false;
  private pingTimer: number | null = null;

  /** Candidats d'URL restants à essayer + minuteur de tentative. */
  private candidates: string[] = [];
  private candidateIndex = 0;
  private attemptTimer: number | null = null;
  private opened = false;

  /** RTT estimé (ms, lissé). 0 tant qu'aucun pong n'est arrivé. */
  rttMs = 0;
  /** Offset estimé serveur - local (ms, lissé) : serverTs = localTs + offset. */
  serverOffsetMs = 0;
  private offsetInitialized = false;

  constructor(cb: NetClientCallbacks, room: string | null = null) {
    this.cb = cb;
    this.room = room;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Construit les URL candidates : base-relative d'abord (si préfixe), puis canonique. */
  private static buildCandidates(room: string | null): string[] {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.host;
    const suffix = room !== null ? `?room=${encodeURIComponent(room)}` : '';
    const urls: string[] = [];
    // Répertoire de la page courante (ex. '/apps/strike/' -> '/apps/strike/ws').
    const base = location.pathname.replace(/[^/]*$/, '');
    if (base !== '/') {
      urls.push(`${proto}//${host}${base.replace(/\/+$/, '')}${WS_PATH}${suffix}`);
    }
    const canonical = `${proto}//${host}${WS_PATH}${suffix}`;
    if (!urls.includes(canonical)) urls.push(canonical);
    return urls;
  }

  /** Ouvre le socket (essaie les candidats en séquence). Idempotent. */
  connect(): void {
    if (this.ws) return;
    this.intentionalClose = false;
    this.candidates = NetClient.buildCandidates(this.room);
    this.candidateIndex = 0;
    this.tryCurrentCandidate();
  }

  private tryCurrentCandidate(): void {
    const url = this.candidates[this.candidateIndex];
    if (!url) {
      // Tous les candidats ont échoué : diagnostic HTTP puis échec.
      console.error('[net] tous les candidats WS ont échoué', this.candidates);
      fetch('/healthz')
        .then((r) => console.warn(`[net] diagnostic /healthz -> HTTP ${r.status} (le serveur HTTP répond ; le proxy bloque probablement l'upgrade WebSocket)`))
        .catch(() => console.warn('[net] diagnostic /healthz injoignable (serveur ou proxy HTTP en échec aussi)'));
      queueMicrotask(() => this.cb.onClose(false));
      return;
    }
    console.info(`[net] tentative WS ${this.candidateIndex + 1}/${this.candidates.length} : ${url}`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // URL invalide / contexte non sécurisé : candidat suivant.
      this.advanceCandidate();
      return;
    }
    this.ws = ws;
    this.opened = false;
    this.attemptTimer = window.setTimeout(() => {
      this.attemptTimer = null;
      if (!this.opened) {
        console.warn(`[net] timeout ${ATTEMPT_TIMEOUT_MS} ms sans ouverture : ${url}`);
        this.teardownSocket();
        this.advanceCandidate();
      }
    }, ATTEMPT_TIMEOUT_MS);

    ws.onopen = () => {
      this.clearAttemptTimer();
      this.opened = true;
      console.info(`[net] WebSocket ouvert : ${url}`);
      this.startPing();
      this.cb.onOpen();
    };
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const msg = decodeMsg<ServerMsg>(event.data);
      if (msg === null) return;
      if (msg.t === 'pong' && Number.isFinite(msg.c) && Number.isFinite(msg.s)) {
        this.handlePong(msg.c, msg.s);
      }
      this.cb.onMessage(msg);
    };
    ws.onclose = (ev: CloseEvent) => {
      this.clearAttemptTimer();
      const intentional = this.intentionalClose;
      const neverOpened = !this.opened;
      console.warn(`[net] socket fermé (code ${ev.code}, raison "${ev.reason}", ouvert: ${this.opened}, intentionnel: ${intentional})`);
      if (!intentional && neverOpened && this.candidateIndex + 1 < this.candidates.length) {
        this.teardownSocket();
        this.advanceCandidate();
        return;
      }
      this.teardown();
      this.cb.onClose(intentional);
    };
    ws.onerror = () => {
      /* onclose suit toujours onerror : la gestion est centralisée là-bas. */
    };
  }

  private advanceCandidate(): void {
    this.candidateIndex++;
    this.tryCurrentCandidate();
  }

  private clearAttemptTimer(): void {
    if (this.attemptTimer !== null) {
      window.clearTimeout(this.attemptTimer);
      this.attemptTimer = null;
    }
  }

  /** Sérialise et envoie un message (ignoré si le socket n'est pas ouvert). */
  send(msg: ClientMsg): void {
    if (this.connected && this.ws) {
      this.ws.send(encodeMsg(msg));
    }
  }

  /** Fermeture volontaire (pas d'annonce de perte de connexion). */
  close(): void {
    if (!this.ws) return;
    this.intentionalClose = true;
    this.clearAttemptTimer();
    const ws = this.ws;
    try {
      ws.close();
    } catch {
      /* silencieux */
    }
    // Si le navigateur ne déclenche pas onclose (socket jamais ouvert), on
    // libère tout de suite les références ; le callback onClose(intentional)
    // n'est pas requis côté GameClient (disconnect() fait son propre ménage).
    if (ws.readyState === WebSocket.CONNECTING) {
      this.teardown();
    }
  }

  /** Estimation du temps serveur courant (ms epoch). */
  serverNow(): number {
    return Date.now() + this.serverOffsetMs;
  }

  private teardownSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        /* silencieux */
      }
      this.ws = null;
    }
  }

  private teardown(): void {
    this.clearAttemptTimer();
    this.stopPing();
    this.teardownSocket();
  }

  private startPing(): void {
    this.stopPing();
    this.send({ t: 'ping', c: Date.now() });
    this.pingTimer = window.setInterval(() => {
      this.send({ t: 'ping', c: Date.now() });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handlePong(c: number, s: number): void {
    const rtt = Math.max(0, Date.now() - c);
    this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * RTT_SMOOTH + rtt * (1 - RTT_SMOOTH);
    const offset = s - c - rtt / 2;
    if (!this.offsetInitialized) {
      this.serverOffsetMs = offset;
      this.offsetInitialized = true;
    } else {
      this.serverOffsetMs =
        this.serverOffsetMs * OFFSET_SMOOTH + offset * (1 - OFFSET_SMOOTH);
    }
  }
}
