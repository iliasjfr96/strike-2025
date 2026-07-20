// ============================================================================
// STRIKE 2025 — server/attach.ts
// Attache le serveur de jeu MULTI-ROOM (RoomManager + WebSocket /ws?room=id +
// transport HTTP /io?room=id) à n'importe quel serveur HTTP Node existant.
// Sans paramètre room (anciens clients, tests) : salon principal « main ».
// ============================================================================

import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { WS_PATH } from '../src/shared/protocol.js';
import type { MapState } from '../src/shared/mapObjects.js';
import { RoomManager } from './Rooms.js';
import { attachHttpIo } from './HttpIo.js';
import { clientIp } from './Admin.js';
import { recordSession } from './Stats.js';

export interface GameAttachment {
  rooms: RoomManager;
  ioHandler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}

export interface AttachOptions {
  /**
   * true  (production) : détruit les upgrades hors /ws (sécurité).
   * false (dev Vite)   : ignore les upgrades hors /ws SANS détruire — le HMR
   *                      de Vite gère ses propres connexions WebSocket.
   */
  destroyUnknownUpgrades: boolean;
  /** État d'édition initial du salon principal (data/map-objects.json). */
  mainMapState?: MapState;
}

export function attachGame(httpServer: HttpServer, opts: AttachOptions): GameAttachment {
  const rooms = new RoomManager(opts.mainMapState ?? { objects: [], baseEdits: [] });
  const ioHandler = attachHttpIo((roomId) => rooms.resolve(roomId).game);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    let roomId: string | null = null;
    try {
      const u = new URL(req.url ?? '', 'http://localhost');
      pathname = u.pathname;
      roomId = u.searchParams.get('room');
    } catch {
      pathname = '';
    }
    // Accepte /ws exact ET tout chemin se terminant par /ws (proxies préfixés).
    if (pathname === WS_PATH || pathname.endsWith(WS_PATH)) {
      const game = rooms.resolve(roomId).game;
      // Statistiques de fréquentation : 1 connexion = 1 session de jeu.
      recordSession(clientIp(req));
      wss.handleUpgrade(req, socket, head, (ws) => {
        game.handleConnection(ws);
      });
    } else if (opts.destroyUnknownUpgrades) {
      socket.destroy();
    }
  });

  return { rooms, ioHandler };
}
