// ============================================================================
// STRIKE 2025 — server/Bots.ts
// Bots serveur : complètent la room jusqu'à 4v4 (noms « BOT-xxx », bot:true).
// FSM : PATROL (polylignes WAYPOINTS de map.ts, aller-retour, changement de
// lane possible aux abscisses -20/0/+20) -> ENGAGE si ennemi visible à
// < BOT_ENGAGE_DIST (occlusion RÉELLE par raycast map, pas de triche) :
// visée avec erreur angulaire 2-4°, rafales de 3-6 tirs puis pause.
// Les bots utilisent stepBody + MAP_COLLIDERS exactement comme les humains,
// et leurs tirs passent par la même validation autoritaire (Combat.fireShot).
// ============================================================================

import type { ClassId, TeamId } from '../src/shared/protocol.js';
import { BOT_ENGAGE_DIST, TICK_DT } from '../src/shared/protocol.js';
import { WAYPOINTS } from '../src/shared/map.js';
import type { Vec3 } from '../src/shared/sim.js';
import {
  KEY_FORWARD,
  KEY_SPRINT,
  clampPitch,
  dirFromYawPitch,
  eyePos,
  raycastAABBs,
  stepBody,
} from '../src/shared/sim.js';
import { CLASS_IDS, WEAPONS, minShotIntervalMs } from '../src/shared/weapons.js';
import type { Game } from './Game.js';
import { fireShot } from './Combat.js';
import { currentWeapon, makePlayer, playerInfo } from './Player.js';
import type { ServerPlayer } from './Player.js';
import { respawnPlayer } from './Spawns.js';

type Lane = 'left' | 'center' | 'right';
const LANES: Lane[] = ['left', 'center', 'right'];

/** État FSM d'un bot. */
export interface BotBrain {
  lane: Lane;
  wpIndex: number;
  wpDir: 1 | -1;
  /** Id de l'ennemi engagé, -1 en patrouille. */
  targetId: number;
  burstLeft: number;
  nextShotAt: number;
  pauseUntil: number;
  errYaw: number;
  errPitch: number;
  errRolledAt: number;
  /** Anti-repathing en boucle dans les zones de changement de lane. */
  repathAt: number;
  /** Anti-blocage : position de référence du dernier contrôle. */
  stuckCheckAt: number;
  stuckX: number;
  stuckZ: number;
  shootSeq: number;
}

// NB : les cerveaux vivent dans game.botBrains (un jeu = un salon — les ids
// de joueurs ne sont uniques QUE par salon).

function makeBrain(x: number, z: number): BotBrain {
  const lane = LANES[Math.floor(Math.random() * LANES.length)];
  return {
    lane,
    wpIndex: nearestWpIndex(lane, x, z),
    wpDir: Math.random() < 0.5 ? 1 : -1,
    targetId: -1,
    burstLeft: 0,
    nextShotAt: 0,
    pauseUntil: 0,
    errYaw: 0,
    errPitch: 0,
    errRolledAt: 0,
    repathAt: 0,
    stuckCheckAt: 0,
    stuckX: x,
    stuckZ: z,
    shootSeq: 0,
  };
}

function nearestWpIndex(lane: Lane, x: number, z: number): number {
  const wps = WAYPOINTS[lane];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < wps.length; i++) {
    const d = Math.hypot(wps[i][0] - x, wps[i][1] - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const BOT_NAME_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function botName(game: Game): string {
  for (let tries = 0; tries < 20; tries++) {
    let suffix = '';
    for (let i = 0; i < 3; i++) {
      suffix += BOT_NAME_CHARS[Math.floor(Math.random() * BOT_NAME_CHARS.length)];
    }
    const name = `BOT-${suffix}`;
    let taken = false;
    for (const p of game.players.values()) {
      if (p.name === name) {
        taken = true;
        break;
      }
    }
    if (!taken) return name;
  }
  return `BOT-${Math.floor(Math.random() * 1000)}`;
}

/** Ajoute un bot dans l'équipe et le diffuse (ev join + ev respawn). */
export function addBot(game: Game, team: TeamId): ServerPlayer {
  const id = game.nextId++;
  const classId: ClassId = CLASS_IDS[Math.floor(Math.random() * CLASS_IDS.length)];
  const p = makePlayer(id, botName(game), team, classId, true, game.weapons, game.loadouts[classId]);
  game.players.set(id, p);
  game.botBrains.set(id, makeBrain(p.body.pos.x, p.body.pos.z));
  game.broadcast({ t: 'ev', kind: 'join', player: playerInfo(p) });
  respawnPlayer(game, p);
  return p;
}

/** Retire un bot (remplacé par un humain ou équilibrage). */
export function removeBot(game: Game, p: ServerPlayer): void {
  game.botBrains.delete(p.id);
  game.players.delete(p.id);
  game.broadcast({ t: 'ev', kind: 'leave', id: p.id });
}

/** Met à jour tous les bots (appelé en tête de tick, 30 Hz). */
export function updateBots(game: Game, now: number): void {
  for (const p of game.players.values()) {
    if (!p.bot) continue;
    let brain = game.botBrains.get(p.id);
    if (!brain) {
      brain = makeBrain(p.body.pos.x, p.body.pos.z);
      game.botBrains.set(p.id, brain);
    }
    if (!p.alive) continue;
    stepBot(game, p, brain, now);
  }
}

/** Ennemi visible le plus proche (occlusion réelle par raycast), ou null. */
function pickTarget(game: Game, p: ServerPlayer, now: number): ServerPlayer | null {
  const eye = eyePos(p.body);
  let best: ServerPlayer | null = null;
  let bestD = BOT_ENGAGE_DIST;
  for (const e of game.players.values()) {
    if (e.team === p.team || !e.alive) continue;
    if (e.protectUntil > now) continue; // ne pas gaspiller sur un protégé
    const cx = e.body.pos.x;
    const cy = e.body.pos.y + e.body.height * 0.55; // centre de masse
    const cz = e.body.pos.z;
    const dx = cx - eye.x;
    const dy = cy - eye.y;
    const dz = cz - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= bestD || dist < 1e-3) continue;
    // Occlusion : un mur entre l'œil et la cible (marge 0.5 m) cache l'ennemi.
    const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
    const wall = raycastAABBs(eye, dir, game.colliders, dist - 0.5);
    if (wall) continue;
    best = e;
    bestD = dist;
  }
  return best;
}

function stepBot(game: Game, p: ServerPlayer, brain: BotBrain, now: number): void {
  const target = pickTarget(game, p, now);
  let keys = 0;

  if (target) {
    // ---------------- ENGAGE ----------------
    brain.targetId = target.id;
    const eye = eyePos(p.body);
    const cx = target.body.pos.x;
    const cy = target.body.pos.y + target.body.height * 0.55;
    const cz = target.body.pos.z;
    const dx = cx - eye.x;
    const dy = cy - eye.y;
    const dz = cz - eye.z;
    const distXZ = Math.hypot(dx, dz);
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = clampPitch(Math.atan2(dy, distXZ));

    // Erreur angulaire 2-4°, re-tirée périodiquement.
    if (now - brain.errRolledAt > 350) {
      const amp = ((2 + Math.random() * 2) * Math.PI) / 180;
      brain.errYaw = (Math.random() * 2 - 1) * amp;
      brain.errPitch = (Math.random() * 2 - 1) * amp;
      brain.errRolledAt = now;
    }

    // Rafales de 3-6 tirs, pauses entre rafales.
    if (now >= brain.pauseUntil && now >= brain.nextShotAt) {
      if (brain.burstLeft <= 0) {
        brain.burstLeft = 3 + Math.floor(Math.random() * 4);
        brain.pauseUntil = now + 500 + Math.random() * 700;
      } else {
        const w = currentWeapon(p);
        const dir = dirFromYawPitch(p.yaw + brain.errYaw, clampPitch(p.pitch + brain.errPitch));
        fireShot(game, p, {
          seq: ++brain.shootSeq,
          origin: eye,
          dir,
          weapon: w.id,
          ads: false,
        });
        brain.burstLeft--;
        brain.nextShotAt = now + game.minShotIntervalMs(w.id) * 1.05 + 5;
      }
    }
    brain.stuckCheckAt = now + 2000; // pas d'anti-blocage à l'arrêt
    brain.stuckX = p.body.pos.x;
    brain.stuckZ = p.body.pos.z;
  } else {
    // ---------------- PATROL ----------------
    brain.targetId = -1;
    brain.burstLeft = 0;
    const wps = WAYPOINTS[brain.lane];
    const wp = wps[brain.wpIndex];
    const dx = wp[0] - p.body.pos.x;
    const dz = wp[1] - p.body.pos.z;
    if (Math.hypot(dx, dz) < 1.8) {
      advanceWaypoint(brain);
    }
    // Changement de lane possible aux abscisses -20 / 0 / +20.
    const ax = Math.abs(p.body.pos.x);
    const inCrossing = Math.abs(ax - 20) < 2.5 || ax < 2.5;
    if (inCrossing && now >= brain.repathAt) {
      brain.repathAt = now + 2500;
      if (Math.random() < 0.3) {
        const others = LANES.filter((l) => l !== brain.lane);
        brain.lane = others[Math.floor(Math.random() * others.length)];
        brain.wpIndex = nearestWpIndex(brain.lane, p.body.pos.x, p.body.pos.z);
        brain.wpDir = Math.random() < 0.5 ? 1 : -1;
      }
    }
    // Anti-blocage : si le bot n'a quasiment pas bougé en 2 s, on saute au
    // waypoint suivant (et on inverse la direction aux extrémités).
    if (now >= brain.stuckCheckAt) {
      const moved = Math.hypot(p.body.pos.x - brain.stuckX, p.body.pos.z - brain.stuckZ);
      if (moved < 0.8) {
        advanceWaypoint(brain);
        if (Math.random() < 0.35) {
          brain.wpDir = brain.wpDir === 1 ? -1 : 1;
        }
      }
      brain.stuckCheckAt = now + 2000;
      brain.stuckX = p.body.pos.x;
      brain.stuckZ = p.body.pos.z;
    }
    const wp2 = WAYPOINTS[brain.lane][brain.wpIndex];
    p.yaw = Math.atan2(-(wp2[0] - p.body.pos.x), -(wp2[1] - p.body.pos.z));
    p.pitch = 0;
    keys = KEY_FORWARD | KEY_SPRINT;
  }

  // Munitions : reload si chargeur vide, sinon bascule sur le secondaire si
  // la réserve est à sec aussi.
  const w = currentWeapon(p);
  if (w.mag <= 0 && w.reloadingUntil === 0) {
    if (w.reserve > 0) {
      game.startReload(p);
    } else if (p.slot === 0) {
      game.switchSlot(p, 1);
    }
  }

  // Simulation identique aux humains (mêmes colliders, même intégrateur).
  stepBody(
    p.body,
    { yaw: p.yaw, pitch: p.pitch, keys },
    game.colliders,
    TICK_DT,
    game.weapons[currentWeapon(p).id].mobility,
  );
}

/** Avance au waypoint suivant (aller-retour aux extrémités de la polyligne). */
function advanceWaypoint(brain: BotBrain): void {
  const len = WAYPOINTS[brain.lane].length;
  let n = brain.wpIndex + brain.wpDir;
  if (n < 0 || n >= len) {
    brain.wpDir = brain.wpDir === 1 ? -1 : 1;
    n = brain.wpIndex + brain.wpDir;
  }
  brain.wpIndex = Math.max(0, Math.min(len - 1, n));
}
