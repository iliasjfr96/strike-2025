// ============================================================================
// STRIKE 2025 — instance.ts
// Instance unique du moteur (bridge.md §3). App.tsx appelle
// `initGameClient(canvas)` une fois le canvas monté ; l'UI importe
// `gameClient` là où elle en a besoin (boutons JOUER / UAV / classe).
// IMPLEMENTÉ PAR L'AGENT MOTEUR : la mécanique interne vit dans GameClient.
// ============================================================================

import { GameClient } from './GameClient';

let current: GameClient | null = null;

/**
 * Crée (une seule fois) le GameClient sur le canvas fourni par App.tsx.
 * Idempotent : les appels suivants renvoient l'instance existante.
 */
export function initGameClient(canvas: HTMLCanvasElement): GameClient {
  if (!current) {
    current = new GameClient(canvas);
  }
  return current;
}

/**
 * Accès UI au client moteur. Tant qu'App.tsx n'a pas initialisé l'instance,
 * les appels sont ignorés avec un avertissement (sécurité de montage).
 */
export const gameClient: GameClient = new Proxy({} as GameClient, {
  get(_target, prop: keyof GameClient) {
    if (!current) {
      return () =>
        console.warn('[stub] gameClient non initialisé — App.tsx doit appeler initGameClient(canvas)');
    }
    const value = current[prop];
    return typeof value === 'function' ? value.bind(current) : value;
  },
});
