// ============================================================================
// STRIKE 2025 — server/Modes.ts
// Moteur de MODES DE JEU par salon, piloté par le pack de map (gameMode +
// zones placées dans l'éditeur : kind 'zone:capture' / 'zone:bombsite').
//  - TDM  : comportement historique (kills -> score d'équipe).
//  - DOM  : zones de capture tenues -> points par seconde, cible de score.
//  - R&D  : rounds alternés SANS respawn, pose de bombe (E maintenu dans un
//           site), compte à rebours, désamorçage, victoires de round.
// Le moteur est APPELÉ par Game.simTick à chaque tick (30 Hz) et diffuse un
// ModeStateMsg (~4 Hz + à chaque événement) + des EvMode (annonces FR).
// ============================================================================

import type {
  GameModeConfig,
  ModeStateMsg,
  PlacedObject,
  TeamId,
  ZoneState,
} from '../src/shared/protocol.js';
import { TICK_DT } from '../src/shared/protocol.js';
import {
  MAX_BOMB_SITES,
  MAX_CAPTURE_ZONES,
  modeSetting,
  posInZone,
  zoneRectsFromObjects,
} from '../src/shared/mapObjects.js';
import type { ZoneRect } from '../src/shared/mapObjects.js';
import { KEY_USE } from '../src/shared/sim.js';
import { respawnPlayer } from './Spawns.js';
import type { Game } from './Game.js';
import type { ServerPlayer } from './Player.js';

const TEAM_NAMES: Record<TeamId, string> = { 0: 'SPECTRE', 1: 'RAVAGE' };
const ZONE_LETTERS = 'ABCDEFGH';

/** Joueur (pieds) dans une zone. */
function inZone(p: ServerPlayer, z: ZoneRect): boolean {
  return posInZone(p.body.pos.x, p.body.pos.y, p.body.pos.z, z);
}

// ----------------------------------------------------------------------------
// Interface commune
// ----------------------------------------------------------------------------

export interface ModeEngine {
  readonly type: 'tdm' | 'dom' | 'sad';
  /** Kills -> score d'équipe + victoire au score ? (TDM uniquement). */
  readonly killsScore: boolean;
  /** Cible de score effective (affichée au client + fin de partie). */
  scoreTarget(): number;
  /** Durée de match effective (s). */
  matchDurationS(): number;
  /** Respawn automatique autorisé ? (R&D : non pendant un round). */
  allowRespawn(): boolean;
  /** Un tick de simulation (30 Hz), après la sim des joueurs. */
  tick(now: number): void;
  /** État courant (envoyé aux nouveaux venus + périodiquement). */
  stateMsg(): ModeStateMsg | null;
  /** Nouvelle partie (reset). */
  reset(now: number): void;
  /** Mort d'un joueur (R&D : détection d'élimination d'équipe). */
  onDeath(victim: ServerPlayer, now: number): void;
}

/** Construit le moteur du salon selon le pack. */
export function buildModeEngine(game: Game, mode: GameModeConfig | undefined, objects: PlacedObject[]): ModeEngine {
  if (mode?.type === 'dom') {
    const zones = zoneRectsFromObjects(objects, 'zone:capture', MAX_CAPTURE_ZONES);
    if (zones.length > 0) return new DomEngine(game, mode, zones);
    console.warn('[mode] pack DOM sans zone de capture — retour TDM');
  }
  if (mode?.type === 'sad') {
    const sites = zoneRectsFromObjects(objects, 'zone:bombsite', MAX_BOMB_SITES);
    if (sites.length > 0) return new SadEngine(game, mode, sites);
    console.warn('[mode] pack R&D sans site de bombe — retour TDM');
  }
  return new TdmEngine(game, mode);
}

// ----------------------------------------------------------------------------
// TDM — comportement historique (réglages optionnels du pack)
// ----------------------------------------------------------------------------

class TdmEngine implements ModeEngine {
  readonly type = 'tdm' as const;
  readonly killsScore = true;

  private readonly game: Game;
  private readonly mode: GameModeConfig | undefined;

  constructor(game: Game, mode: GameModeConfig | undefined) {
    this.game = game;
    this.mode = mode;
  }

  scoreTarget(): number {
    // Réglage du pack prioritaire, sinon valeur du salon (env e2e comprise).
    return this.mode?.scoreTarget ?? this.game.scoreTarget;
  }
  matchDurationS(): number {
    return this.mode?.matchDurationS ?? this.game.matchDurationS;
  }
  allowRespawn(): boolean {
    return true;
  }
  tick(): void {
    /* rien : le TDM vit dans Combat (kills) + timer de Game */
  }
  stateMsg(): ModeStateMsg | null {
    return null;
  }
  reset(): void {
    /* rien */
  }
  onDeath(): void {
    /* rien */
  }
}

// ----------------------------------------------------------------------------
// DOM — domination (zones de capture)
// ----------------------------------------------------------------------------

class DomEngine implements ModeEngine {
  readonly type = 'dom' as const;
  readonly killsScore = false;

  private readonly states: ZoneState[];
  /** Accumulateurs fractionnaires de points par équipe. */
  private readonly acc: [number, number] = [0, 0];
  private lastBroadcastAt = 0;
  private dirty = true;

  private readonly game: Game;
  private readonly mode: GameModeConfig;
  private readonly zones: ZoneRect[];

  constructor(game: Game, mode: GameModeConfig, zones: ZoneRect[]) {
    this.game = game;
    this.mode = mode;
    this.zones = zones;
    this.states = zones.map(() => ({ owner: -1, progress: 0, capturing: -1 }));
  }

  scoreTarget(): number {
    return this.mode.scoreTarget ?? 200;
  }
  matchDurationS(): number {
    return modeSetting(this.mode, 'matchDurationS');
  }
  allowRespawn(): boolean {
    return true;
  }

  reset(): void {
    for (const s of this.states) {
      s.owner = -1;
      s.progress = 0;
      s.capturing = -1;
    }
    this.acc[0] = 0;
    this.acc[1] = 0;
    this.dirty = true;
  }

  onDeath(): void {
    /* rien */
  }

  tick(now: number): void {
    if (this.game.phase !== 'playing') return;
    const captureTime = modeSetting(this.mode, 'captureTimeS');
    const pps = modeSetting(this.mode, 'pointsPerSecond');

    for (let i = 0; i < this.zones.length; i++) {
      const zone = this.zones[i];
      const st = this.states[i];
      let n0 = 0;
      let n1 = 0;
      for (const p of this.game.players.values()) {
        if (!p.alive) continue;
        if (!inZone(p, zone)) continue;
        if (p.team === 0) n0++;
        else n1++;
      }
      const present: -1 | TeamId = n0 > 0 && n1 === 0 ? 0 : n1 > 0 && n0 === 0 ? 1 : -1;

      if (present === -1) {
        // Vide ou contesté : la progression décroît doucement.
        if (st.progress > 0) {
          st.progress = Math.max(0, st.progress - TICK_DT / captureTime / 2);
          if (st.progress === 0) st.capturing = -1;
          this.dirty = true;
        }
      } else if (st.owner !== present) {
        // Capture en cours au profit de `present`.
        if (st.capturing !== present) {
          st.capturing = present;
          st.progress = 0;
        }
        st.progress = Math.min(1, st.progress + TICK_DT / captureTime);
        this.dirty = true;
        if (st.progress >= 1) {
          st.owner = present;
          st.capturing = -1;
          st.progress = 0;
          this.game.broadcast({
            t: 'ev',
            kind: 'mode',
            sub: 'zone',
            team: present,
            msg: `ZONE ${ZONE_LETTERS[i]} CAPTURÉE — ${TEAM_NAMES[present]}`,
          });
        }
      }
    }

    // Points par seconde et par zone tenue (broadcast au point entier).
    let scoreChanged = false;
    for (const t of [0, 1] as TeamId[]) {
      let held = 0;
      for (const s of this.states) if (s.owner === t) held++;
      if (held === 0) continue;
      this.acc[t] += held * pps * TICK_DT;
      const whole = Math.floor(this.acc[t]);
      if (whole >= 1) {
        this.acc[t] -= whole;
        this.game.scores[t] += whole;
        scoreChanged = true;
      }
    }
    if (scoreChanged) {
      this.game.broadcast({ t: 'ev', kind: 'score', scores: [...this.game.scores] as [number, number] });
      const target = this.scoreTarget();
      if (this.game.scores[0] >= target || this.game.scores[1] >= target) {
        this.game.endMatch();
        return;
      }
    }

    // État de mode : à chaque changement, sinon ~4 Hz pendant une capture.
    if (this.dirty || now - this.lastBroadcastAt >= 250) {
      if (this.dirty) {
        this.game.broadcast(this.stateMsg()!);
        this.lastBroadcastAt = now;
        this.dirty = false;
      }
    }
  }

  stateMsg(): ModeStateMsg {
    return { t: 'mode', zones: this.states.map((s) => ({ ...s })) };
  }
}

// ----------------------------------------------------------------------------
// R&D — recherche & destruction (bombe, rounds sans respawn)
// ----------------------------------------------------------------------------

class SadEngine implements ModeEngine {
  readonly type = 'sad' as const;
  readonly killsScore = false;

  private round = 0;
  private attackers: TeamId = 0;
  private roundPhase: 'live' | 'planted' | 'over' = 'over';
  private roundEndsAt = 0;
  private bombSite = -1;
  private bombX = 0;
  private bombZ = 0;
  /** Action E en cours : id joueur + progression 0..1. */
  private action: { playerId: number; kind: 'plant' | 'defuse'; progress: number } | null = null;
  private lastBroadcastAt = 0;

  private readonly game: Game;
  private readonly mode: GameModeConfig;
  private readonly sites: ZoneRect[];

  constructor(game: Game, mode: GameModeConfig, sites: ZoneRect[]) {
    this.game = game;
    this.mode = mode;
    this.sites = sites;
  }

  scoreTarget(): number {
    return modeSetting(this.mode, 'roundsToWin');
  }
  matchDurationS(): number {
    // Garde-fou global (un match R&D se décide aux rounds bien avant).
    return modeSetting(this.mode, 'matchDurationS') * 3;
  }
  allowRespawn(): boolean {
    return this.roundPhase === 'over'; // morts en attente jusqu'au round suivant
  }

  reset(now: number): void {
    this.round = 0;
    this.roundPhase = 'over';
    this.roundEndsAt = now + 3000; // 1er round dans 3 s
    this.bombSite = -1;
    this.action = null;
  }

  private announce(msg: string, sub: 'plant' | 'defuse' | 'boom' | 'roundWin' | 'info', team?: TeamId): void {
    this.game.broadcast({ t: 'ev', kind: 'mode', sub, team, msg });
  }

  private startRound(now: number): void {
    this.round++;
    this.attackers = ((this.round - 1) % 2) as TeamId;
    this.roundPhase = 'live';
    this.roundEndsAt = now + modeSetting(this.mode, 'roundTimeS') * 1000;
    this.bombSite = -1;
    this.action = null;
    // Tout le monde repart du spawn, armes fraîches.
    for (const p of this.game.players.values()) {
      respawnPlayer(this.game, p);
    }
    this.announce(
      `ROUND ${this.round} — ATTAQUE : ${TEAM_NAMES[this.attackers]} (posez la bombe, touche E)`,
      'info',
      this.attackers,
    );
    this.broadcastState(now);
  }

  private endRound(winner: TeamId, reason: string, now: number): void {
    if (this.roundPhase === 'over') return;
    this.roundPhase = 'over';
    this.roundEndsAt = now + 5000;
    this.action = null;
    this.game.scores[winner]++;
    this.game.broadcast({ t: 'ev', kind: 'score', scores: [...this.game.scores] as [number, number] });
    this.announce(`${reason} — ROUND ${TEAM_NAMES[winner]} (${this.game.scores[0]}–${this.game.scores[1]})`, 'roundWin', winner);
    this.broadcastState(now);
    if (this.game.scores[winner] >= this.scoreTarget()) {
      this.game.endMatch();
    }
  }

  onDeath(victim: ServerPlayer, now: number): void {
    if (this.game.phase !== 'playing' || this.roundPhase === 'over') return;
    // Équipe entièrement éliminée ?
    let alive0 = 0;
    let alive1 = 0;
    for (const p of this.game.players.values()) {
      if (!p.alive || p.id === victim.id) continue;
      if (p.team === 0) alive0++;
      else alive1++;
    }
    const def = (1 - this.attackers) as TeamId;
    const aliveAtt = this.attackers === 0 ? alive0 : alive1;
    const aliveDef = def === 0 ? alive0 : alive1;
    if (this.roundPhase === 'live' && aliveAtt === 0) {
      this.endRound(def, 'ATTAQUANTS ÉLIMINÉS', now);
    } else if (aliveDef === 0) {
      // Plus personne pour désamorcer / défendre.
      this.endRound(this.attackers, 'DÉFENSEURS ÉLIMINÉS', now);
    }
  }

  tick(now: number): void {
    if (this.game.phase !== 'playing') return;

    // Transitions de phase temporelles.
    if (this.roundPhase === 'over') {
      if (now >= this.roundEndsAt) this.startRound(now);
      return;
    }
    if (this.roundPhase === 'live' && now >= this.roundEndsAt) {
      this.endRound((1 - this.attackers) as TeamId, 'TEMPS ÉCOULÉ', now);
      return;
    }
    if (this.roundPhase === 'planted' && now >= this.roundEndsAt) {
      this.announce('LA BOMBE A EXPLOSÉ', 'boom', this.attackers);
      this.endRound(this.attackers, 'OBJECTIF DÉTRUIT', now);
      return;
    }

    // Action E (pose / désamorçage). Les BOTS agissent automatiquement.
    const plantTime = modeSetting(this.mode, 'plantTimeS');
    const defuseTime = modeSetting(this.mode, 'defuseTimeS');
    let actor: ServerPlayer | null = null;
    let kind: 'plant' | 'defuse' | null = null;
    let siteIdx = -1;

    for (const p of this.game.players.values()) {
      if (!p.alive) continue;
      const wantsUse = p.bot ? true : (p.lastKeys & KEY_USE) !== 0;
      if (!wantsUse) continue;
      if (this.roundPhase === 'live' && p.team === this.attackers) {
        for (let i = 0; i < this.sites.length; i++) {
          if (inZone(p, this.sites[i])) {
            actor = p;
            kind = 'plant';
            siteIdx = i;
            break;
          }
        }
      } else if (this.roundPhase === 'planted' && p.team !== this.attackers) {
        const d = Math.hypot(p.body.pos.x - this.bombX, p.body.pos.z - this.bombZ);
        if (d <= 2.5) {
          actor = p;
          kind = 'defuse';
        }
      }
      if (actor) break;
    }

    if (actor && kind) {
      if (!this.action || this.action.playerId !== actor.id || this.action.kind !== kind) {
        this.action = { playerId: actor.id, kind, progress: 0 };
      }
      const total = kind === 'plant' ? plantTime : defuseTime;
      this.action.progress = Math.min(1, this.action.progress + TICK_DT / total);
      if (this.action.progress >= 1) {
        if (kind === 'plant') {
          this.roundPhase = 'planted';
          this.bombSite = siteIdx;
          this.bombX = actor.body.pos.x;
          this.bombZ = actor.body.pos.z;
          this.roundEndsAt = now + modeSetting(this.mode, 'bombTimeS') * 1000;
          this.action = null;
          this.announce(`BOMBE POSÉE — SITE ${ZONE_LETTERS[siteIdx]}`, 'plant', this.attackers);
        } else {
          this.action = null;
          this.announce('BOMBE DÉSAMORCÉE', 'defuse', (1 - this.attackers) as TeamId);
          this.endRound((1 - this.attackers) as TeamId, 'BOMBE DÉSAMORCÉE', now);
          return;
        }
        this.broadcastState(now);
      }
    } else if (this.action) {
      this.action = null; // action interrompue (sorti de zone / E relâché / mort)
    }

    // État périodique (~4 Hz) — nécessaire pour les barres de progression.
    if (now - this.lastBroadcastAt >= 250) this.broadcastState(now);
  }

  private broadcastState(now: number): void {
    this.game.broadcast(this.stateMsg());
    this.lastBroadcastAt = now;
  }

  stateMsg(): ModeStateMsg {
    return {
      t: 'mode',
      round: this.round,
      attackers: this.attackers,
      roundPhase: this.roundPhase,
      roundEndsAt: this.roundEndsAt,
      bombSite: this.bombSite,
      action: this.action ? { ...this.action } : null,
    };
  }
}
