// ============================================================================
// STRIKE 2025 — server/Spawns.ts
// Choix du spawn : parmi les 6 SpawnPoint de l'équipe, score = distance à
// l'ennemi vivant le plus proche ; on choisit le MAX (spawn le plus sûr),
// ex æquo départagés aléatoirement. Gère aussi le respawn complet (corps,
// armes, protection, historique) et la diffusion de l'ev respawn.
// ============================================================================

import type { SpawnPoint } from '../src/shared/map.js';
import type { TeamId } from '../src/shared/protocol.js';
import { HP_MAX } from '../src/shared/protocol.js';
import { makeBody } from '../src/shared/sim.js';
import { makeWeaponState, weaponForSlot } from '../src/shared/weapons.js';
import type { Game } from './Game.js';
import type { ServerPlayer } from './Player.js';

/** Spawn le plus sûr : max de la distance à l'ennemi vivant le plus proche. */
export function chooseSpawn(game: Game, team: TeamId): SpawnPoint {
  // Pré-collecte des positions ennemies vivantes.
  const enemies: { x: number; z: number }[] = [];
  for (const p of game.players.values()) {
    if (p.team !== team && p.alive) {
      enemies.push({ x: p.body.pos.x, z: p.body.pos.z });
    }
  }
  const hasEnemy = enemies.length > 0;

  let best: SpawnPoint[] = [];
  let bestScore = -Infinity;
  // Spawns du PACK si le créateur en a placé, sinon spawns par défaut
  // (mis à l'échelle de la map) — voir Game.spawnsFor.
  for (const sp of game.spawnsFor(team)) {
    let dMin = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - sp.x, e.z - sp.z);
      if (d < dMin) dMin = d;
    }
    const score = hasEnemy ? dMin : 0; // aucun ennemi : tous ex æquo
    if (score > bestScore + 1e-6) {
      bestScore = score;
      best = [sp];
    } else if (Math.abs(score - bestScore) <= 1e-6) {
      best.push(sp);
    }
  }
  return best[Math.floor(Math.random() * best.length)];
}

/**
 * (Re)place un joueur : spawn sûr, HP pleins, armes fraîches, protection de
 * spawn, historique de lag comp vidé (sinon on rembobinerait vers le lieu de
 * mort). Diffuse `ev respawn` à toute la room.
 */
export function respawnPlayer(game: Game, p: ServerPlayer): void {
  const now = Date.now();
  const sp = chooseSpawn(game, p.team);
  p.body = makeBody(sp.x, sp.y, sp.z);
  p.yaw = sp.yaw;
  p.pitch = 0;
  p.hp = HP_MAX;
  p.alive = true;
  p.respawnAt = 0;
  p.protectUntil = now + game.spawnProtectionS * 1000;
  p.lastDamageAt = 0;
  p.damageLog = [];
  const [w0, w1] = game.loadouts[p.classId];
  p.weapons = [
    makeWeaponState(w0, game.weapons[w0]),
    makeWeaponState(w1, game.weapons[w1]),
  ];
  p.slot = 0;
  p.switchedAt = 0;
  p.lastShotAt = 0;
  p.inputs.length = 0;
  p.dtBank = 0.25; // vie neuve : budget de simulation plein
  p.history.clear();
  game.broadcast({
    t: 'ev',
    kind: 'respawn',
    id: p.id,
    x: sp.x,
    y: sp.y,
    z: sp.z,
    yaw: sp.yaw,
    protectUntil: p.protectUntil,
  });
}
