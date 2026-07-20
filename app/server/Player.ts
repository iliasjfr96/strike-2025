// ============================================================================
// STRIKE 2025 — server/Player.ts
// État serveur complet d'un joueur (humain ou bot) : corps simulé (BodyState
// partagé), armes, streak, régénération, protection de spawn, stats, file
// d'inputs et historique pour la lag compensation.
// ============================================================================

import type {
  ClassId,
  InputData,
  PlayerFinalStats,
  PlayerInfo,
  TeamId,
  WeaponSlot,
} from '../src/shared/protocol.js';
import { HP_MAX } from '../src/shared/protocol.js';
import type { BodyState } from '../src/shared/sim.js';
import { makeBody } from '../src/shared/sim.js';
import type { WeaponSpec, WeaponState } from '../src/shared/weapons.js';
import { makeWeaponState, weaponForSlot } from '../src/shared/weapons.js';
import type { WeaponId } from '../src/shared/protocol.js';
import { History } from './History.js';

/** Dégât infligé récemment à ce joueur (fenêtre d'assist). */
export interface DamageEntry {
  attackerId: number;
  damage: number;
  /** Timestamp serveur (ms). */
  at: number;
}

export interface ServerPlayer {
  id: number;
  name: string;
  team: TeamId;
  classId: ClassId;
  bot: boolean;

  /** Corps simulé par stepBody (position des pieds, vélocité, posture). */
  body: BodyState;
  /** Angles de visée courants (dernier input consommé). */
  yaw: number;
  pitch: number;

  hp: number;
  alive: boolean;
  /** Dernier bitmask de touches intégré (KEY_USE pour les actions de mode). */
  lastKeys: number;
  /** Timestamp (ms) du respawn prévu, 0 si vivant. */
  respawnAt: number;
  /** Fin de protection de spawn (ms), 0 si inactive. */
  protectUntil: number;
  /** Dernier dégât subi (ms) — déclenche la régénération après REGEN_DELAY_S. */
  lastDamageAt: number;
  /** Dégâts subis récemment (calcul des assists, fenêtre ASSIST_WINDOW_S). */
  damageLog: DamageEntry[];

  weapons: [WeaponState, WeaponState];
  slot: WeaponSlot;
  /** Timestamp du dernier changement d'arme (draw time). */
  switchedAt: number;
  lastShotAt: number;
  lastShotSeq: number;

  /** Points personnels de streak (coût UAV : UAV_COST). */
  streakPoints: number;

  kills: number;
  deaths: number;
  assists: number;
  /** Score personnel cumulé (points). */
  score: number;

  /** RTT estimé via le heartbeat ws natif (ms) — lag compensation. */
  rttMs: number;

  /** File d'inputs validés en attente de consommation par le tick.
   *  Jamais purgée : le reliquat d'un tick est consommé au suivant
   *  (bornée à INPUT_QUEUE_MAX à l'admission). */
  inputs: InputData[];
  lastInputSeq: number;
  /** Token-bucket de temps simulable (s) — anti speed-hack soutenu. */
  dtBank: number;

  /** Ring buffer des états passés (lag compensation). */
  history: History;
}

export function makePlayer(
  id: number,
  name: string,
  team: TeamId,
  classId: ClassId,
  bot: boolean,
  weaponTable?: Record<WeaponId, WeaponSpec>,
  loadout?: [WeaponId, WeaponId],
): ServerPlayer {
  const w0 = loadout?.[0] ?? weaponForSlot(classId, 0);
  const w1 = loadout?.[1] ?? weaponForSlot(classId, 1);
  return {
    id,
    name,
    team,
    classId,
    bot,
    body: makeBody(0, 0, 0),
    yaw: 0,
    pitch: 0,
    hp: HP_MAX,
    alive: false,
    lastKeys: 0,
    respawnAt: 0,
    protectUntil: 0,
    lastDamageAt: 0,
    damageLog: [],
    // Chargeurs/réserves selon la table d'armes DU SALON (mods d'armurerie).
    weapons: [
      makeWeaponState(w0, weaponTable?.[w0]),
      makeWeaponState(w1, weaponTable?.[w1]),
    ],
    slot: 0,
    switchedAt: 0,
    lastShotAt: 0,
    lastShotSeq: -1,
    streakPoints: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    score: 0,
    rttMs: 0,
    inputs: [],
    lastInputSeq: -1,
    dtBank: 0.25,
    history: new History(),
  };
}

/** Arme actuellement en main. */
export function currentWeapon(p: ServerPlayer): WeaponState {
  return p.weapons[p.slot];
}

/** Infos statiques diffusées dans welcome / ev join. */
export function playerInfo(p: ServerPlayer): PlayerInfo {
  return { id: p.id, name: p.name, team: p.team, classId: p.classId, bot: p.bot };
}

/** Stats de fin de partie (phase 'end'). */
export function finalStats(p: ServerPlayer): PlayerFinalStats {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    score: p.score,
  };
}
