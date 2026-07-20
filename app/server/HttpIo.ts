// ============================================================================
// STRIKE 2025 — server/HttpIo.ts
// Transport de secours 100 % HTTP pour les clients derrière un proxy qui
// bloque l'upgrade WebSocket. Émule le sous-ensemble de l'interface `ws`
// utilisé par Game (send/close/terminate/ping/on('message'|'close')/
// readyState/OPEN) via des sessions long-poll :
//   POST /io/join           -> { sid }
//   GET  /io/poll?sid=...   -> { msgs: [...] }  (réponse immédiate si file
//                             non vide, sinon après POLL_HOLD_MS)
//   POST /io/send?sid=...   -> { msgs: [...] }  (trames client, JSON encodé)
//   POST /io/leave?sid=...  -> fermeture propre
// Tolère les préfixes de chemin (comparaison par suffixe) comme pour /ws.
// ============================================================================

import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebSocket } from 'ws';
import type { Game } from './Game.js';

/** Durée max de rétention d'un poll sans message (ms). Doit rester
 *  inférieur à HEARTBEAT_DEAD_MS (10 s) pour que le heartbeat ne tue pas
 *  une session HTTP active : chaque poll « touche » la connexion. */
const POLL_HOLD_MS = 5000;
/** Session sans poll/send depuis ce délai -> fermeture (ms). */
const SESSION_DEAD_MS = 15000;
/** Bornes anti-abus. */
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MSGS_PER_SEND = 32;
const MAX_MSG_CHARS = 2048;
const MAX_OUTBOX = 512;

interface PollWaiter {
  res: ServerResponse;
  timer: NodeJS.Timeout;
}

/** Socket virtuel compatible avec l'usage que Game fait de `ws`. */
export class VirtualSocket extends EventEmitter {
  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = 1;

  private outbox: string[] = [];
  private waiter: PollWaiter | null = null;
  /** Session propriétaire (assignée à la création, après le new). */
  session!: Session;

  /** Game -> client : empile la trame et répond au poll en attente. */
  send(data: string): void {
    if (this.readyState === this.CLOSED) return;
    if (this.outbox.length >= MAX_OUTBOX) this.outbox.shift();
    this.outbox.push(data);
    this.flush();
  }

  /** Heartbeat natif : sans objet sur HTTP (la GC de session s'en charge). */
  ping(): void {
    /* no-op */
  }

  terminate(): void {
    this.close();
  }

  close(): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.flush();
    this.emit('close');
    this.session.dispose();
  }

  /** Enregistre un poll en attente (ou répond immédiatement si des messages). */
  holdPoll(res: ServerResponse): void {
    // Un seul poll actif par session : un nouveau poll libère l'ancien.
    this.releaseWaiter();
    if (this.outbox.length > 0) {
      this.respond(res, this.outbox.splice(0, this.outbox.length));
      return;
    }
    if (this.readyState === this.CLOSED) {
      this.respond(res, []);
      return;
    }
    const timer = setTimeout(() => {
      this.waiter = null;
      this.respond(res, this.readyState === this.CLOSED ? [] : this.outbox.splice(0, this.outbox.length));
    }, POLL_HOLD_MS);
    this.waiter = { res, timer };
    res.on('close', () => {
      // Client parti avant la réponse : libère le waiter sans répondre.
      if (this.waiter?.res === res) {
        clearTimeout(this.waiter.timer);
        this.waiter = null;
      }
    });
  }

  private flush(): void {
    if (this.waiter === null) return;
    const { res, timer } = this.waiter;
    this.waiter = null;
    clearTimeout(timer);
    this.respond(res, this.outbox.splice(0, this.outbox.length));
  }

  private releaseWaiter(): void {
    if (this.waiter === null) return;
    const { res, timer } = this.waiter;
    this.waiter = null;
    clearTimeout(timer);
    this.respond(res, []);
  }

  private respond(res: ServerResponse, msgs: string[]): void {
    try {
      if (!res.writableEnded) {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          ...CORS_HEADERS,
        });
        res.end(JSON.stringify({ msgs }));
      }
    } catch {
      /* client parti : ignoré */
    }
  }
}

interface Session {
  sid: string;
  vws: VirtualSocket;
  /** Salon (Game) auquel la session est rattachée (résolu au join). */
  game: Game;
  lastSeenAt: number;
  dispose(): void;
}

/** Headers CORS : l'aperçu peut tourner dans un iframe à origine opaque —
 *  sans eux, les fetch() cross-origin sont bloqués par le navigateur. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
    });
    res.end(JSON.stringify(body));
  } catch {
    /* ignoré */
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/**
 * Installe le transport HTTP de secours (multi-room : le salon est résolu au
 * join via ?room=id, replis « main »). Retourne un handler
 * `(req, res) => boolean` : true si la requête a été traitée (chemin /io/*).
 */
export function attachHttpIo(
  resolveGame: (roomId: string | null) => Game,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const sessions = new Map<string, Session>();

  const gc = setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) {
      if (now - s.lastSeenAt > SESSION_DEAD_MS) {
        sessions.delete(s.sid);
        s.vws.terminate();
      }
    }
  }, 5000);
  gc.unref();

  const removeSession = (sid: string): void => {
    sessions.delete(sid);
  };

  return async (req, res) => {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    } catch {
      return false;
    }
    // Tolère un préfixe de proxy : /apps/strike/io/join -> /io/join.
    const m = pathname.match(/\/io\/(join|poll|send|leave)$/);
    if (m === null) return false;
    const action = m[1];

    // Préflight CORS (POST cross-origin avec content-type: application/json).
    if (req.method === 'OPTIONS') {
      try {
        res.writeHead(204, CORS_HEADERS);
        res.end();
      } catch {
        /* ignoré */
      }
      return true;
    }

    const url = new URL(req.url ?? '', 'http://localhost');
    const sid = url.searchParams.get('sid') ?? '';
    const session = sid !== '' ? sessions.get(sid) : undefined;

    if (action === 'join') {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method' });
        return true;
      }
      const game = resolveGame(url.searchParams.get('room'));
      const newSid = randomBytes(9).toString('base64url');
      const vws = new VirtualSocket();
      const sess: Session = {
        sid: newSid,
        vws,
        game,
        lastSeenAt: Date.now(),
        dispose: () => removeSession(newSid),
      };
      vws.session = sess;
      sessions.set(newSid, sess);
      // Enregistre auprès du Game exactement comme une connexion WebSocket,
      // puis estime un RTT initial raisonnable pour la lag compensation.
      game.handleConnection(vws as unknown as WebSocket);
      game.setConnRtt(vws as unknown as WebSocket, 80);
      console.info(`[io] session HTTP ouverte : ${newSid}`);
      json(res, 200, { sid: newSid });
      return true;
    }

    if (session === undefined) {
      json(res, 404, { error: 'session' });
      return true;
    }
    session.lastSeenAt = Date.now();
    session.game.touchConnection(session.vws as unknown as WebSocket);

    if (action === 'poll') {
      if (req.method !== 'GET') {
        json(res, 405, { error: 'method' });
        return true;
      }
      session.vws.holdPoll(res);
      return true;
    }

    if (action === 'send') {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method' });
        return true;
      }
      const raw = await readBody(req, MAX_BODY_BYTES);
      if (raw === null) {
        json(res, 413, { error: 'payload' });
        return true;
      }
      try {
        const parsed = JSON.parse(raw) as { msgs?: unknown };
        const msgs = Array.isArray(parsed.msgs) ? parsed.msgs : [];
        let n = 0;
        for (const item of msgs) {
          if (typeof item !== 'string' || item.length > MAX_MSG_CHARS) continue;
          if (++n > MAX_MSGS_PER_SEND) break;
          session.vws.emit('message', Buffer.from(item, 'utf8'));
        }
      } catch {
        /* JSON invalide : ignoré */
      }
      json(res, 200, { ok: true });
      return true;
    }

    // action === 'leave'
    session.vws.close();
    json(res, 200, { ok: true });
    return true;
  };
}
