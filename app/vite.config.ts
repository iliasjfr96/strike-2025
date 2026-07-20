import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

// https://vite.dev/config/
// En dev : `npm run dev` (scripts/dev.mjs) lance le serveur de jeu Node sur
// GAME_SERVER_PORT (défaut 3002) — on proxyfie /ws (WebSocket), /io
// (transport HTTP de secours) et /healthz vers lui. En production,
// server/index.ts sert directement le build (npm start).
const GAME_PORT = process.env.GAME_SERVER_PORT || '3002';
const GAME_TARGET = `http://127.0.0.1:${GAME_PORT}`;

export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  server: {
    proxy: {
      '/ws': {
        target: GAME_TARGET,
        ws: true,
      },
      '/io': {
        target: GAME_TARGET,
      },
      '/healthz': {
        target: GAME_TARGET,
      },
      '/mapedit': {
        target: GAME_TARGET,
      },
      '/rooms': {
        target: GAME_TARGET,
      },
      '/mods': {
        target: GAME_TARGET,
      },
      '/admin': {
        target: GAME_TARGET,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
