// ============================================================================
// STRIKE 2025 — scripts/dev.mjs
// Lance le client ET le serveur de jeu en développement :
//   1. Bundle du serveur (esbuild -> dist-server/index.js), démarré sur
//      GAME_SERVER_PORT (défaut 3002)
//   2. Vite dev server (client) — le proxy /ws, /io et /healthz de
//      vite.config.ts redirige vers ce serveur de jeu.
// ============================================================================

import { spawn } from 'node:child_process';
import { build } from 'esbuild';

const GAME_PORT = process.env.GAME_SERVER_PORT || '3002';

// 1. Bundle du serveur de jeu.
await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['ws'],
  outfile: 'dist-server/index.js',
  logLevel: 'silent',
});
console.info(`[dev] serveur de jeu bundlé -> dist-server/index.js (port ${GAME_PORT})`);

// 2. Démarre le serveur de jeu.
const server = spawn('node', ['dist-server/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: GAME_PORT },
});
server.on('exit', (code) => {
  console.error(`[dev] le serveur de jeu s'est arrêté (code ${code})`);
  process.exit(code ?? 1);
});

// 3. Démarre Vite (client).
const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });
vite.on('exit', (code) => {
  console.error(`[dev] vite s'est arrêté (code ${code})`);
  server.kill();
  process.exit(code ?? 0);
});

const shutdown = () => {
  server.kill();
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
