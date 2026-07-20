// ============================================================================
// STRIKE 2025 — server/Teams.ts
// Assignation des équipes (la plus petite, égalité -> SPECTRE) et gestion du
// remplissage bots : compléter jusqu'à TEAM_TARGET_SIZE (4v4), retirer un bot
// quand un humain rejoint une équipe pleine, reboucher avec un bot quand un
// humain part.
// ============================================================================

import type { TeamId } from '../src/shared/protocol.js';
import { TEAM_RAVAGE, TEAM_SPECTRE, TEAM_TARGET_SIZE } from '../src/shared/protocol.js';
import type { Game } from './Game.js';
import { addBot, removeBot } from './Bots.js';

/** Nombre de joueurs (humains + bots) par équipe : [SPECTRE, RAVAGE]. */
export function teamCounts(game: Game): [number, number] {
  let c0 = 0;
  let c1 = 0;
  for (const p of game.players.values()) {
    if (p.team === TEAM_SPECTRE) c0++;
    else c1++;
  }
  return [c0, c1];
}

/** Équipe la plus petite ; égalité -> SPECTRE (règle figée). */
export function pickTeam(game: Game): TeamId {
  const [c0, c1] = teamCounts(game);
  return c0 <= c1 ? TEAM_SPECTRE : TEAM_RAVAGE;
}

/**
 * Libère une place pour un humain : si l'équipe est déjà à TEAM_TARGET_SIZE
 * et contient un bot, ce bot est retiré (ev leave diffusé).
 */
export function makeRoomForHuman(game: Game, team: TeamId): void {
  let size = 0;
  let bot: { id: number; bot: boolean } | null = null;
  for (const p of game.players.values()) {
    if (p.team !== team) continue;
    size++;
    if (p.bot && bot === null) bot = p;
  }
  if (size >= TEAM_TARGET_SIZE && bot !== null) {
    const victim = game.players.get(bot.id);
    if (victim) removeBot(game, victim);
  }
}

/** Complète les deux équipes avec des bots jusqu'à TEAM_TARGET_SIZE. */
export function fillWithBots(game: Game): void {
  if (game.disableBots) return;
  for (let guard = 0; guard < 16; guard++) {
    const [c0, c1] = teamCounts(game);
    if (c0 >= TEAM_TARGET_SIZE && c1 >= TEAM_TARGET_SIZE) return;
    addBot(game, c0 <= c1 ? TEAM_SPECTRE : TEAM_RAVAGE);
  }
}
