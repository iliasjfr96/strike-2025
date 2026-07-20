// ============================================================================
// STRIKE 2025 — server/Combat.ts
// Validation autoritaire des tirs hitscan : cadence (tolérance 10 %),
// munitions, seq strictement croissant, origine recalée sur l'œil serveur si
// écart > 1.5 m, direction re-normalisée, LAG COMPENSATION (rembobinage des
// adversaires via leur History), raycast map puis joueurs, dégâts avec chute
// de distance + headshot x2, assists (>= ASSIST_MIN_DAMAGE dans la fenêtre),
// pas de friendly fire. Tirer annule sa propre protection de spawn.
// ============================================================================

import type { TeamScores, WeaponId } from '../src/shared/protocol.js';
import {
  ASSIST_MIN_DAMAGE,
  ASSIST_WINDOW_S,
  HEADSHOT_MULTIPLIER,
  HISTORY_MAX_AGE_MS,
  LAG_COMP_MARGIN_MS,
  POINTS_ASSIST,
  POINTS_KILL,
  RESPAWN_DELAY_S,
  SHOT_MAX_DIST,
} from '../src/shared/protocol.js';
import type { AABB, PlayerTarget, Vec3 } from '../src/shared/sim.js';
import {
  damageAtDistance,
  eyePos,
  playerAABB,
  raycastAABBs,
  raycastPlayers,
  vec3,
} from '../src/shared/sim.js';
import { WEAPONS, minShotIntervalMs } from '../src/shared/weapons.js';
import type { Game } from './Game.js';
import { clampNum } from './Net.js';
import { currentWeapon } from './Player.js';
import type { ServerPlayer } from './Player.js';

/** Tolérance de gigue réseau sur la fin de reload (ms) : le miroir client
 *  termine son reload ~rtt/2 avant que son premier tir n'arrive au serveur —
 *  sans cette grâce, ce tir tombait pile sur la frontière et était mangé
 *  silencieusement une fois sur deux (désynchronisant le chargeur). */
const RELOAD_GRACE_MS = 150;

/** Tir déjà validé syntaxiquement (champs finis) par Game. */
export interface ShotRequest {
  seq: number;
  origin: Vec3;
  dir: Vec3;
  weapon: WeaponId;
  ads: boolean;
}

/**
 * Tente un tir pour `p`. Toutes les règles d'autorité sont appliquées ici ;
 * utilisé aussi bien pour les humains (ShootMsg) que pour les bots (tir
 * synthétique), qui subissent exactement les mêmes validations.
 */
export function fireShot(game: Game, p: ServerPlayer, req: ShotRequest): void {
  // Phase 'end' : inputs de tir ignorés, pas de dégâts.
  if (game.phase !== 'playing') return;
  if (!p.alive) return;

  const now = Date.now();
  const w = currentWeapon(p);
  const spec = game.weapons[w.id];

  // L'arme déclarée doit être celle en main (anti-triche).
  if (req.weapon !== w.id) {
    game.sendTo(p.id, { t: 'ev', kind: 'reject', what: 'shoot', reason: 'arme non en main' });
    return;
  }
  // Reload en cours (termine paresseusement, avec grâce de gigue réseau).
  game.maybeFinishReload(p, w, now + RELOAD_GRACE_MS);
  if (w.reloadingUntil > 0) return;
  // Draw time après un switch (tolérance symétrique à la gigue).
  if (now - p.switchedAt < spec.drawMs * 0.85) return;
  if (w.mag <= 0) {
    game.sendTo(p.id, { t: 'ev', kind: 'reject', what: 'shoot', reason: 'chargeur vide' });
    return;
  }
  // Anti-rejeu : seq strictement croissant.
  if (req.seq <= p.lastShotSeq) return;
  // Cadence (tolérance 10 % pour la gigue réseau).
  if (now - p.lastShotAt < game.minShotIntervalMs(w.id) * 0.9) return;

  // Direction : norme dans [0.99, 1.01] puis normalisation.
  const norm = Math.hypot(req.dir.x, req.dir.y, req.dir.z);
  if (norm < 0.99 || norm > 1.01) return;
  const dir = vec3(req.dir.x / norm, req.dir.y / norm, req.dir.z / norm);

  // ---- Tir accepté ----------------------------------------------------------
  p.lastShotSeq = req.seq;
  p.lastShotAt = now;
  w.mag--;
  p.protectUntil = 0; // tirer annule sa propre protection de spawn

  // Origine : recalée sur l'œil serveur si écart > 1.5 m.
  const eye = eyePos(p.body);
  let origin = req.origin;
  const od = Math.hypot(origin.x - eye.x, origin.y - eye.y, origin.z - eye.z);
  if (!(od <= 1.5)) origin = eye;

  // Raycast map d'abord (colliders DU SALON) : distance du mur le plus proche.
  const wall = raycastAABBs(origin, dir, game.colliders, SHOT_MAX_DIST);
  const wallDist = wall ? wall.dist : SHOT_MAX_DIST;

  // ---- Lag compensation -----------------------------------------------------
  const rewind = clampNum(p.rttMs / 2 + LAG_COMP_MARGIN_MS, 0, HISTORY_MAX_AGE_MS);
  const targetTime = now - rewind;
  const targets: PlayerTarget[] = [];
  for (const e of game.players.values()) {
    if (e.team === p.team || !e.alive) continue; // pas de friendly fire
    if (e.protectUntil > now) continue; // protection de spawn respectée
    const s = e.history.sample(targetTime);
    const px = s ? s.x : e.body.pos.x;
    const py = s ? s.y : e.body.pos.y;
    const pz = s ? s.z : e.body.pos.z;
    const h = s ? s.height : e.body.height;
    targets.push({ id: e.id, box: playerAABB(vec3(px, py, pz), h) });
  }

  const hit = raycastPlayers(origin, dir, targets, wallDist);
  if (!hit) return;
  const victim = game.players.get(hit.id);
  if (!victim || !victim.alive || victim.team === p.team) return;

  // ---- Dégâts ----------------------------------------------------------------
  let dmg = spec.falloff
    ? damageAtDistance(spec.damage, hit.dist, spec.falloff.start, spec.falloff.end, spec.falloff.minMult)
    : spec.damage;
  if (hit.isHead) dmg *= HEADSHOT_MULTIPLIER;
  dmg = Math.round(dmg);
  if (dmg <= 0) return;

  victim.hp -= dmg;
  victim.lastDamageAt = now;
  // Élague les entrées hors fenêtre d'assist (sinon un joueur qui régénère
  // sans mourir accumule des entrées pendant toute la partie).
  const cutoff = now - ASSIST_WINDOW_S * 1000;
  while (victim.damageLog.length > 0 && victim.damageLog[0].at < cutoff) {
    victim.damageLog.shift();
  }
  victim.damageLog.push({ attackerId: p.id, damage: dmg, at: now });

  const hpLeft = Math.max(0, Math.round(victim.hp));
  game.sendTo(p.id, { t: 'ev', kind: 'hit', targetId: victim.id, damage: dmg, hp: hpLeft, head: hit.isHead });
  game.sendTo(victim.id, { t: 'ev', kind: 'damage', fromId: p.id, damage: dmg, hp: hpLeft, head: hit.isHead });

  if (victim.hp <= 0) {
    applyKill(game, p, victim, w.id, hit.isHead, now);
  }
}

/** Mort d'un joueur : stats, assists, score d'équipe, événements, victoire. */
function applyKill(
  game: Game,
  killer: ServerPlayer,
  victim: ServerPlayer,
  weapon: WeaponId,
  head: boolean,
  now: number,
): void {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
  victim.respawnAt = now + RESPAWN_DELAY_S * 1000;
  victim.body.vel.x = 0;
  victim.body.vel.y = 0;
  victim.body.vel.z = 0;
  // Reload annulé par la mort.
  for (const w of victim.weapons) w.reloadingUntil = 0;

  killer.kills++;
  killer.streakPoints += POINTS_KILL;
  killer.score += POINTS_KILL;

  // Assists : tout joueur (hors tueur) ayant infligé >= ASSIST_MIN_DAMAGE
  // dans les ASSIST_WINDOW_S dernières secondes.
  const assistIds: number[] = [];
  const windowStart = now - ASSIST_WINDOW_S * 1000;
  const sums = new Map<number, number>();
  for (const d of victim.damageLog) {
    if (d.at < windowStart || d.attackerId === killer.id) continue;
    sums.set(d.attackerId, (sums.get(d.attackerId) ?? 0) + d.damage);
  }
  for (const [attackerId, dmgSum] of sums) {
    if (dmgSum < ASSIST_MIN_DAMAGE) continue;
    const a = game.players.get(attackerId);
    if (!a) continue;
    a.assists++;
    a.streakPoints += POINTS_ASSIST;
    a.score += POINTS_ASSIST;
    assistIds.push(attackerId);
  }
  victim.damageLog = [];

  game.scores[killer.team]++;
  game.broadcast({
    t: 'ev',
    kind: 'kill',
    killerId: killer.id,
    victimId: victim.id,
    weapon,
    head,
    assistIds,
    scores: [...game.scores] as TeamScores,
  });

  if (game.scores[killer.team] >= game.scoreTarget) {
    game.endMatch();
  }
}
