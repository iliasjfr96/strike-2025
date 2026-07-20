// ============================================================================
// STRIKE 2025 — HttpTransport.ts
// Transport de secours 100 % HTTP (aucun WebSocket requis) :
//  - serveur -> client : long-poll GET /io/poll (le serveur répond dès qu'un
//    message est en file, sinon après ~5 s, et le client re-interroge aussitôt)
//  - client -> serveur : POST /io/send (messages regroupés toutes les 66 ms)
//  - session           : POST /io/join (+ sid), POST /io/leave
// Compatible avec les proxies qui bloquent l'upgrade WebSocket ou servent
// l'app sous un préfixe de chemin. Même protocole applicatif (protocol.ts).
// ============================================================================

import { decodeMsg, encodeMsg } from '../../shared/protocol';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import type { Transport, TransportCallbacks } from './transport';

/** Intervalle de regroupement des envois client (ms). */
const FLUSH_INTERVAL_MS = 66;
/** Intervalle des pings applicatifs (ms). */
const PING_INTERVAL_MS = 2000;
/** Échecs HTTP consécutifs avant abandon. */
const MAX_CONSECUTIVE_FAILURES = 5;
/** Lissage exponentiel RTT / offset. */
const RTT_SMOOTH = 0.8;
const OFFSET_SMOOTH = 0.9;

interface JoinResponse {
  sid?: unknown;
}

export class HttpTransport implements Transport {
  private readonly cb: TransportCallbacks;
  private sid = '';
  private bases: string[] = [];
  private baseIndex = 0;
  private opened = false;
  private intentionalClose = false;
  private closed = false;

  private outQueue: string[] = [];
  private flushInFlight = false;
  private flushTimer: number | null = null;
  private pollActive = false;
  private pingTimer: number | null = null;
  private failures = 0;

  rttMs = 0;
  serverOffsetMs = 0;
  private offsetInitialized = false;

  /** Salon ciblé (multi-room) — null : salon principal. */
  private readonly room: string | null;

  constructor(cb: TransportCallbacks, room: string | null = null) {
    this.cb = cb;
    this.room = room;
  }

  get connected(): boolean {
    return this.opened && !this.closed;
  }

  /** Bases candidates : préfixe de la page puis racine (proxy sous préfixe). */
  private static buildBases(): string[] {
    const bases: string[] = [];
    const base = location.pathname.replace(/[^/]*$/, '');
    if (base !== '/') bases.push(`${base.replace(/\/+$/, '')}/io`);
    if (!bases.includes('/io')) bases.push('/io');
    return bases;
  }

  connect(): void {
    if (this.opened || this.closed) return;
    this.intentionalClose = false;
    this.bases = HttpTransport.buildBases();
    this.baseIndex = 0;
    void this.tryJoin();
  }

  private currentBase(): string {
    return this.bases[this.baseIndex] ?? '';
  }

  private async tryJoin(): Promise<void> {
    const base = this.currentBase();
    if (!base) {
      console.error('[net-http] toutes les bases /io ont échoué', this.bases);
      queueMicrotask(() => this.cb.onClose(false));
      return;
    }
    console.info(`[net-http] tentative join : ${base}/join`);
    try {
      const roomQs = this.room !== null ? `?room=${encodeURIComponent(this.room)}` : '';
      const res = await fetch(`${base}/join${roomQs}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as JoinResponse;
      if (typeof data.sid !== 'string' || data.sid.length === 0) throw new Error('sid absent');
      this.sid = data.sid;
      this.opened = true;
      console.info(`[net-http] session ouverte (${this.sid}) via ${base}`);
      this.startLoops();
      this.cb.onOpen();
    } catch (err) {
      console.warn(`[net-http] join échoué sur ${base} :`, err);
      this.baseIndex++;
      await this.tryJoin();
    }
  }

  private startLoops(): void {
    this.pollActive = true;
    void this.pollLoop();
    this.flushTimer = window.setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.pingTimer = window.setInterval(() => {
      this.send({ t: 'ping', c: Date.now() });
    }, PING_INTERVAL_MS);
    this.send({ t: 'ping', c: Date.now() });
  }

  /** Long-poll continu : le serveur répond dès qu'il a des messages. */
  private async pollLoop(): Promise<void> {
    while (this.pollActive && !this.closed) {
      try {
        const res = await fetch(`${this.currentBase()}/poll?sid=${encodeURIComponent(this.sid)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { msgs?: unknown };
        this.failures = 0;
        if (this.closed) return;
        const msgs = Array.isArray(data.msgs) ? data.msgs : [];
        for (const raw of msgs) {
          if (typeof raw !== 'string') continue;
          const msg = decodeMsg<ServerMsg>(raw);
          if (msg === null) continue;
          if (msg.t === 'pong' && Number.isFinite(msg.c) && Number.isFinite(msg.s)) {
            this.handlePong(msg.c, msg.s);
          }
          this.cb.onMessage(msg);
        }
      } catch (err) {
        if (this.closed || !this.pollActive) return;
        this.failures++;
        console.warn(`[net-http] poll échoué (${this.failures}/${MAX_CONSECUTIVE_FAILURES}) :`, err);
        if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
          this.teardown();
          this.cb.onClose(false);
          return;
        }
        await new Promise((r) => window.setTimeout(r, 300 * this.failures));
      }
    }
  }

  /** Vide la file sortante (regroupement). */
  private async flush(): Promise<void> {
    if (this.closed || !this.opened || this.flushInFlight || this.outQueue.length === 0) return;
    this.flushInFlight = true;
    const msgs = this.outQueue.splice(0, this.outQueue.length);
    try {
      const res = await fetch(`${this.currentBase()}/send?sid=${encodeURIComponent(this.sid)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgs }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.failures = 0;
    } catch (err) {
      // Re-file en tête pour retenter au prochain flush : le serveur
      // déduplique par seq (inp.seq <= lastInputSeq → drop), le rejeu est
      // donc sûr. Borné par le compteur d'échecs (abandon global au-delà).
      this.outQueue.unshift(...msgs);
      // Cap de sécurité : ne pas accumuler indéfiniment (messages périmés).
      if (this.outQueue.length > 64) {
        this.outQueue.splice(0, this.outQueue.length - 64);
      }
      this.failures++;
      console.warn(`[net-http] send échoué (${this.failures}/${MAX_CONSECUTIVE_FAILURES}) :`, err);
      if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
        this.teardown();
        this.cb.onClose(false);
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  send(msg: ClientMsg): void {
    if (!this.connected) return;
    this.outQueue.push(encodeMsg(msg));
    if (this.outQueue.length >= 8) void this.flush();
  }

  close(): void {
    if (this.closed) return;
    this.intentionalClose = true;
    const base = this.currentBase();
    const sid = this.sid;
    this.teardown();
    // Préviens le serveur (sans attendre la réponse).
    if (base && sid) {
      void fetch(`${base}/leave?sid=${encodeURIComponent(sid)}`, { method: 'POST' }).catch(() => undefined);
    }
  }

  serverNow(): number {
    return Date.now() + this.serverOffsetMs;
  }

  private teardown(): void {
    this.closed = true;
    this.pollActive = false;
    if (this.flushTimer !== null) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Indique si la fermeture était volontaire (pour le callback onClose). */
  get wasIntentionalClose(): boolean {
    return this.intentionalClose;
  }

  private handlePong(c: number, s: number): void {
    const rtt = Math.max(0, Date.now() - c);
    this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * RTT_SMOOTH + rtt * (1 - RTT_SMOOTH);
    const offset = s - c - rtt / 2;
    if (!this.offsetInitialized) {
      this.serverOffsetMs = offset;
      this.offsetInitialized = true;
    } else {
      this.serverOffsetMs = this.serverOffsetMs * OFFSET_SMOOTH + offset * (1 - OFFSET_SMOOTH);
    }
  }
}
