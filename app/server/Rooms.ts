// ============================================================================
// STRIKE 2025 — server/Rooms.ts
// Multi-room : un salon = une instance Game indépendante (boucle, joueurs,
// bots, colliders, map). Le salon « main » joue l'état d'édition persistant
// (data/map-objects.json) ; les autres salons sont créés à la demande avec
// une map de la bibliothèque (ou la map de base) et sont détruits après
// ROOM_IDLE_MS sans humain. Cap global anti-abus.
// ============================================================================

import { randomBytes } from 'node:crypto';
import type { MapState } from '../src/shared/mapObjects.js';
import { Game } from './Game.js';
import { loadMap } from './MapLibrary.js';
import { sanitizeLabel } from './MapLibrary.js';

/** Salon (hors main) détruit après ce délai sans humain connecté (ms). */
const ROOM_IDLE_MS = 120000;
/** Nombre max de salons simultanés (main compris). */
const MAX_ROOMS = 12;

export interface Room {
  id: string;
  name: string;
  game: Game;
  /** Slug de la map de bibliothèque jouée (null = map du salon principal /
   *  map de base). */
  mapSlug: string | null;
  mapName: string;
  createdAt: number;
  /** Dernier instant où un humain était connecté (GC). */
  lastHumanAt: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  mapName: string;
  humans: number;
  bots: number;
  phase: string;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly main: Room;

  constructor(mainState: MapState) {
    const game = new Game(mainState);
    game.start();
    this.main = {
      id: 'main',
      name: 'Salon principal',
      game,
      mapSlug: null,
      mapName: 'KESTREL YARD',
      createdAt: Date.now(),
      lastHumanAt: Date.now(),
    };
    this.rooms.set('main', this.main);

    // GC des salons vides (jamais le main).
    const gc = setInterval(() => this.collect(), 15000);
    gc.unref();
  }

  /** Salon par id — replis sur main si absent (salon détruit entre-temps). */
  resolve(roomId: string | null | undefined): Room {
    if (roomId && this.rooms.has(roomId)) return this.rooms.get(roomId)!;
    return this.main;
  }

  /** Crée un salon jouant une map de la bibliothèque (ou la map de base). */
  create(rawName: unknown, mapSlug: string | null): Room | null {
    if (this.rooms.size >= MAX_ROOMS) return null;
    let state: MapState = { objects: [], baseEdits: [] };
    let mapName = 'KESTREL YARD';
    if (mapSlug !== null) {
      const loaded = loadMap(mapSlug);
      if (!loaded) return null;
      state = loaded.state;
      mapName = loaded.meta.name;
    }
    const id = `r-${randomBytes(4).toString('hex')}`;
    const game = new Game(state);
    game.start();
    const room: Room = {
      id,
      name: sanitizeLabel(rawName, mapName),
      game,
      mapSlug,
      mapName,
      createdAt: Date.now(),
      lastHumanAt: Date.now(),
    };
    this.rooms.set(id, room);
    console.log(`[rooms] salon créé : ${room.name} (${id}) — map « ${mapName} »`);
    return room;
  }

  /** Liste des salons (UI). */
  list(): RoomInfo[] {
    const out: RoomInfo[] = [];
    for (const r of this.rooms.values()) {
      const humans = r.game.humanCount();
      out.push({
        id: r.id,
        name: r.name,
        mapName: r.mapName,
        humans,
        bots: r.game.players.size - humans,
        phase: r.game.phase,
      });
    }
    // Main d'abord, puis les plus peuplés.
    return out.sort((a, b) => (a.id === 'main' ? -1 : b.id === 'main' ? 1 : b.humans - a.humans));
  }

  /** Fermeture ADMIN d'un salon (jamais le main) : déconnecte tous ses
   *  joueurs (retour menu côté client) et détruit l'instance. */
  close(id: string): boolean {
    if (id === 'main') return false;
    const r = this.rooms.get(id);
    if (!r) return false;
    this.rooms.delete(id);
    r.game.dispose();
    console.log(`[rooms] salon fermé par un admin : ${r.name} (${r.id})`);
    return true;
  }

  /** Détruit les salons (hors main) vides depuis ROOM_IDLE_MS. */
  private collect(): void {
    const now = Date.now();
    for (const r of this.rooms.values()) {
      if (r.id === 'main') continue;
      if (r.game.humanCount() > 0) {
        r.lastHumanAt = now;
        continue;
      }
      if (now - r.lastHumanAt > ROOM_IDLE_MS) {
        this.rooms.delete(r.id);
        r.game.dispose();
        console.log(`[rooms] salon détruit (vide) : ${r.name} (${r.id})`);
      }
    }
  }
}
