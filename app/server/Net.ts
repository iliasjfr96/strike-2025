// ============================================================================
// STRIKE 2025 — server/Net.ts
// Couche réseau : enveloppe de connexion, envoi JSON sûr, sanitisation des
// entrées (pseudo), constantes du heartbeat ws natif (ping/pong).
// ============================================================================

import type { WebSocket } from 'ws';
import type { ServerMsg } from '../src/shared/protocol.js';
import { encodeMsg } from '../src/shared/protocol.js';

/** Intervalle entre deux pings natifs (ms). */
export const HEARTBEAT_INTERVAL_MS = 5000;
/** Sans activité (pong ou message) depuis ce délai -> terminate (ms). */
export const HEARTBEAT_DEAD_MS = 10000;
/** Taille max de la file d'inputs d'un joueur (anti-inondation). */
export const INPUT_QUEUE_MAX = 32;

/** Enveloppe d'une connexion WebSocket (avant ou après `hello`). */
export interface Conn {
  ws: WebSocket;
  /** Id du joueur associé, -1 tant que `hello` n'a pas été reçu. */
  playerId: number;
  /** Dernière activité observée (message ou pong), ms. */
  lastSeenAt: number;
  /** Timestamp du dernier ping envoyé (mesure de RTT), ms. */
  lastPingAt: number;
  /** RTT lissé (ms), utilisé par la lag compensation. */
  rttMs: number;
}

/** Envoi JSON sûr : jamais d'exception, ignore un socket mourant. */
export function send(ws: WebSocket, msg: ServerMsg): void {
  rawSend(ws, encodeMsg(msg));
}

/** Envoi d'une trame DÉJÀ sérialisée (broadcast : stringify une seule fois). */
export function rawSend(ws: WebSocket, data: string): void {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  } catch {
    /* socket en cours de fermeture : ignoré */
  }
}

/**
 * Sanitise un pseudo : trim, whitelist alphanum + « _- », 1..16 caractères.
 * Retourne '' si rien d'exploitable (l'appelant choisit un nom de repli).
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 16);
}

/** Vrai si `v` est un nombre fini (validation champ par champ des trames). */
export function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Clamp borné inclusif. */
export function clampNum(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
