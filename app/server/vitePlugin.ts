// ============================================================================
// STRIKE 2025 — server/vitePlugin.ts
// Plugin Vite qui embarque le serveur de jeu DANS le dev server : le
// WebSocket /ws, le transport HTTP /io et /healthz sont servis sur le même
// port que le frontend (ex. 5173/5174). Indispensable pour les aperçus qui
// ne lancent que `vite` (aucun serveur Node séparé sur le port 3000).
// Inerte en build de production (configureServer ne s'exécute qu'en dev).
// ============================================================================

import type { Server as HttpServer } from 'node:http';
import type { Plugin } from 'vite';
import { attachGame } from './attach.js';

export function strikeGameServer(): Plugin {
  return {
    name: 'strike-2025-game-server',
    configureServer(server) {
      if (!server.httpServer) return;
      const { ioHandler } = attachGame(server.httpServer as unknown as HttpServer, {
        destroyUnknownUpgrades: false,
      });

      // Middleware HTTP : /healthz + transport de secours /io/*.
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url.includes('/healthz')) {
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('ok');
          return;
        }
        if (!url.includes('/io/')) {
          next();
          return;
        }
        void ioHandler(req, res).then((handled) => {
          if (!handled) next();
        });
      });

      console.info('[STRIKE 2025] serveur de jeu intégré au dev server Vite (/ws + /io + /healthz)');
    },
  };
}
