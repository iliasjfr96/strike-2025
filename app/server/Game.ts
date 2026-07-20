// ============================================================================
// STRIKE 2025 — server/Game.ts
// Room globale unique : boucle UNIFIÉE à pas fixe 30 Hz (accumulateur avec
// rattrapage — un stall d'event-loop ne perd jamais de temps de simulation),
// consommation des inputs par BUDGET de temps (somme des dt <= 1,6 × TICK_DT,
// le reliquat RESTE en file — jamais jeté), snapshot JSON 30 Hz émis en fin de
// tick (tuple PlayerSnapshot + ack du dernier seq d'input intégré, streakMask
// bit0 = UAV), phases lobby/playing/end, TDM scoreTarget / matchDurationS
// (constantes protocol.ts, overridables via les hooks d'env §7 pour les
// tests), fin de partie 15 s avec stats puis reset.
// ============================================================================

import type { WebSocket } from 'ws';
import type {
  ClassId,
  ClientMsg,
  GamePhase,
  HelloMsg,
  InputData,
  PlayerInfo,
  PlayerSnapshot,
  ServerMsg,
  ShootMsg,
  TeamId,
  TeamScores,
  WelcomeMsg,
} from '../src/shared/protocol.js';
import {
  DT_MAX,
  END_DURATION_S,
  HP_MAX,
  INPUT_DT_ADMIT_MAX,
  INPUT_DT_BUDGET_PER_TICK,
  MATCH_DURATION_S,
  MAX_INPUTS_PER_TICK,
  MAX_PLAYERS,
  REGEN_DELAY_S,
  REGEN_RATE,
  SCORE_TARGET,
  SPAWN_PROTECTION_S,
  STREAK_UAV,
  TICK_DT,
  TICK_RATE,
  UAV_COST,
  UAV_DURATION_S,
  buildGameConfig,
  decodeMsg,
  encodeMsg,
  round2,
  round3,
} from '../src/shared/protocol.js';
import { mapMeta } from '../src/shared/map.js';
import type { AABB } from '../src/shared/sim.js';
import { clampPitch, stepBody } from '../src/shared/sim.js';
import { CLASS_IDS, WEAPONS } from '../src/shared/weapons.js';
import type { WeaponState } from '../src/shared/weapons.js';
import type { WeaponSlot } from '../src/shared/protocol.js';
import { fireShot } from './Combat.js';
import { updateBots } from './Bots.js';
import { fillWithBots, makeRoomForHuman, pickTeam } from './Teams.js';
import { respawnPlayer } from './Spawns.js';
import {
  HEARTBEAT_DEAD_MS,
  HEARTBEAT_INTERVAL_MS,
  INPUT_QUEUE_MAX,
  isFiniteNum,
  rawSend,
  sanitizeName,
  send,
} from './Net.js';
import type { Conn } from './Net.js';
import { currentWeapon, finalStats, makePlayer, playerInfo } from './Player.js';
import type { ServerPlayer } from './Player.js';
import type { BotBrain } from './Bots.js';
import type { MapState } from '../src/shared/mapObjects.js';
import { buildColliders } from '../src/shared/mapObjects.js';
import type { ClassLoadouts, WeaponId, WeaponModsConfig } from '../src/shared/protocol.js';
import type { WeaponSpec } from '../src/shared/weapons.js';
import { buildLoadoutTable, buildWeaponTable } from '../src/shared/weaponMods.js';

/** Lit un hook d'environnement numérique (défaut si absent/invalide). */
function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Plafond du token-bucket de temps simulable par joueur (s) : absorbe les
 *  rafales de rattrapage légitimes (~0,25 s) sans permettre un speed-hack
 *  soutenu (recharge 1,05× temps réel). */
const DT_BANK_CAP = 0.25;

export class Game {
  readonly players = new Map<number, ServerPlayer>();
  /** playerId -> connexion (humains uniquement). */
  private readonly conns = new Map<number, Conn>();
  private readonly connByWs = new Map<WebSocket, Conn>();

  /** État d'édition de map de CE salon (objets placés + éditions de base). */
  mapState: MapState;
  /** Colliders de CE salon (base éditée + objets) — indépendants par room. */
  readonly colliders: AABB[];
  /** Table d'armes de CE salon (stats d'origine fusionnées avec les mods). */
  weapons: Record<WeaponId, WeaponSpec>;
  /** Loadouts de CE salon (classes -> [primaire, secondaire]). */
  loadouts: Record<ClassId, [WeaponId, WeaponId]>;
  /** Cerveaux des bots de CE salon (les ids de joueurs sont locaux au salon). */
  readonly botBrains = new Map<number, BotBrain>();

  constructor(initialMapState?: MapState) {
    this.mapState = initialMapState ?? { objects: [], baseEdits: [] };
    this.colliders = buildColliders(this.mapState);
    this.weapons = buildWeaponTable(this.mapState.weaponMods ?? {});
    this.loadouts = buildLoadoutTable(this.mapState.loadouts ?? {});
  }

  /** Applique un nouvel état d'édition (sauvegarde d'éditeur) : colliders
   *  reconstruits EN PLACE (les références au tableau restent valides) +
   *  table d'armes refusionnée + diffusion aux clients du salon. */
  applyMap(state: MapState): void {
    this.mapState = state;
    this.colliders.length = 0;
    for (const b of buildColliders(state)) this.colliders.push(b);
    this.weapons = buildWeaponTable(state.weaponMods ?? {});
    this.loadouts = buildLoadoutTable(state.loadouts ?? {});
    this.broadcast({
      t: 'mapObjects',
      objects: state.objects,
      baseEdits: state.baseEdits,
      weaponMods: state.weaponMods ?? {},
      loadouts: state.loadouts ?? {},
      props: state.props ?? [],
      baseTerrain: state.baseTerrain ?? 'kestrel',
    });
  }

  /** Intervalle minimal entre deux tirs (ms) selon la table de CE salon. */
  minShotIntervalMs(id: WeaponId): number {
    return 60000 / this.weapons[id].rpm;
  }

  /** Nombre d'humains connectés (GC des salons vides). */
  humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  /** Arrêt définitif du salon : boucle stoppée + connexions fermées. */
  dispose(): void {
    this.stop();
    for (const conn of this.connByWs.values()) {
      try {
        conn.ws.close();
      } catch {
        /* ignoré */
      }
    }
  }

  nextId = 0;
  tick = 0;
  phase: GamePhase = 'lobby';
  scores: TeamScores = [0, 0];
  /** Timestamp (ms) de fin de la phase courante. */
  endsAt = 0;
  /** Fin d'UAV par équipe [SPECTRE, RAVAGE], 0 si inactif. */
  readonly uavUntil: [number, number] = [0, 0];

  // Hooks d'environnement (usage autorisé : tests E2E — architecture.md §7).
  readonly matchDurationS = envNum('STRIKE_MATCH_DURATION_S', MATCH_DURATION_S);
  readonly scoreTarget = envNum('STRIKE_SCORE_TARGET', SCORE_TARGET);
  readonly spawnProtectionS = envNum('STRIKE_SPAWN_PROTECTION_S', SPAWN_PROTECTION_S);
  readonly disableBots = process.env.STRIKE_DISABLE_BOTS === '1';

  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Échéance (ms epoch) du prochain tick — accumulateur à pas fixe. */
  private nextTickAt = 0;

  // --------------------------------------------------------------------------
  // Cycle de vie — boucle UNIFIÉE sim + snapshot à pas fixe avec rattrapage
  // (phase sim/snap verrouillée : le snapshot est émis en fin de tick ; un
  // stall d'event-loop est rattrapé par plusieurs steps au réveil suivant).
  // --------------------------------------------------------------------------

  start(): void {
    this.stopped = false;
    this.nextTickAt = Date.now() + 1000 / TICK_RATE;
    this.scheduleLoop();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  private scheduleLoop(): void {
    if (this.stopped) return;
    const delay = Math.max(0, this.nextTickAt - Date.now());
    this.loopTimer = setTimeout(() => this.loopStep(), delay);
  }

  private loopStep(): void {
    const tickMs = 1000 / TICK_RATE;
    // Rattrapage borné : max 5 ticks par réveil (stall GC / machine endormie).
    let steps = 0;
    while (Date.now() >= this.nextTickAt && steps < 5) {
      // Le temps LOGIQUE du tick (échéance planifiée) horodate l'historique de
      // lag compensation : pendant un rattrapage, les états restent espacés de
      // 33 ms au lieu de partager le même Date.now().
      this.safeTick(this.nextTickAt);
      this.nextTickAt += tickMs;
      steps++;
    }
    // Stall majeur (> 5 ticks de retard restant) : on repart de l'horloge
    // courante plutôt que de rejouer une rafale infinie.
    if (Date.now() > this.nextTickAt + 4 * tickMs) {
      this.nextTickAt = Date.now() + tickMs;
    }
    this.scheduleLoop();
  }

  private safeTick(tickAtMs: number): void {
    try {
      this.simTick(tickAtMs);
    } catch (err) {
      console.error('[STRIKE] erreur tick :', err);
    }
    // Snapshot en fin de tick (SNAP_RATE == TICK_RATE) : staleness nulle.
    try {
      this.snapshot();
    } catch (err) {
      console.error('[STRIKE] erreur snapshot :', err);
    }
  }

  // --------------------------------------------------------------------------
  // Connexions / messages entrants
  // --------------------------------------------------------------------------

  /** Rafraîchit l'activité d'une connexion (transport HTTP de secours :
   *  les requêtes poll/send doivent compter pour le heartbeat). */
  touchConnection(ws: WebSocket): void {
    const conn = this.connByWs.get(ws);
    if (conn) conn.lastSeenAt = Date.now();
  }

  /** Force le RTT estimé d'une connexion (transport HTTP : pas de ping/pong
   *  natif — valeur initiale raisonnable pour la lag compensation). */
  setConnRtt(ws: WebSocket, ms: number): void {
    const conn = this.connByWs.get(ws);
    if (!conn) return;
    conn.rttMs = ms;
    const p = this.players.get(conn.playerId);
    if (p) p.rttMs = ms;
  }

  handleConnection(ws: WebSocket): void {
    const conn: Conn = {
      ws,
      playerId: -1,
      lastSeenAt: Date.now(),
      lastPingAt: 0,
      rttMs: 0,
    };
    this.connByWs.set(ws, conn);

    ws.on('message', (data: unknown) => {
      conn.lastSeenAt = Date.now();
      let text: string;
      try {
        text = rawToString(data);
      } catch {
        return;
      }
      const msg = decodeMsg<ClientMsg>(text);
      if (msg === null) return;
      try {
        this.routeMessage(conn, msg);
      } catch (err) {
        console.error('[STRIKE] erreur message :', err);
      }
    });

    ws.on('pong', () => {
      const now = Date.now();
      conn.lastSeenAt = now;
      if (conn.lastPingAt > 0) {
        const sample = Math.max(0, now - conn.lastPingAt);
        conn.rttMs = conn.rttMs <= 0 ? sample : conn.rttMs * 0.75 + sample * 0.25;
        const p = this.players.get(conn.playerId);
        if (p) p.rttMs = conn.rttMs;
      }
    });

    ws.on('close', () => this.handleDisconnect(conn));
    ws.on('error', () => {
      /* le close suivra ; rien à faire */
    });
  }

  private handleDisconnect(conn: Conn): void {
    this.connByWs.delete(conn.ws);
    const p = this.players.get(conn.playerId);
    this.conns.delete(conn.playerId);
    conn.playerId = -1;
    if (p && !p.bot) {
      this.players.delete(p.id);
      this.broadcast({ t: 'ev', kind: 'leave', id: p.id });
      // Un humain parti est rebouché par un bot.
      fillWithBots(this);
    }
  }

  /** Validation champ par champ puis routage. Jamais d'exception non catchée. */
  private routeMessage(conn: Conn, msg: ClientMsg): void {
    switch (msg.t) {
      case 'hello': {
        if (conn.playerId !== -1) return; // déjà identifié
        const m = msg as HelloMsg;
        const name = sanitizeName(m.name) || 'JOUEUR';
        const classId: ClassId = (CLASS_IDS as readonly string[]).includes(m.classId)
          ? m.classId
          : 'assault';
        this.addHuman(conn, name, classId);
        return;
      }
      case 'ping': {
        const c = isFiniteNum((msg as { c?: unknown }).c) ? (msg as { c: number }).c : 0;
        send(conn.ws, { t: 'pong', c, s: Date.now() });
        return;
      }
      default:
        break;
    }

    const p = this.players.get(conn.playerId);
    if (!p) return; // trame de jeu avant hello : ignorée

    switch (msg.t) {
      case 'input':
        this.handleInput(p, msg as unknown as InputData);
        return;
      case 'inputs': {
        // Lot d'inputs d'une fenêtre de flush client (~33 ms).
        const list = (msg as { list?: unknown }).list;
        if (!Array.isArray(list) || list.length > 30) return;
        for (const it of list) {
          if (typeof it === 'object' && it !== null) this.handleInput(p, it as InputData);
        }
        return;
      }
      case 'shoot':
        this.handleShoot(p, msg as ShootMsg);
        return;
      case 'reload':
        this.startReload(p);
        return;
      case 'switch': {
        const slot = (msg as { slot?: unknown }).slot;
        if (slot === 0 || slot === 1) this.switchSlot(p, slot);
        return;
      }
      case 'streak':
        this.activateStreak(p);
        return;
      case 'setClass': {
        const cid = (msg as { classId?: unknown }).classId;
        if ((CLASS_IDS as readonly string[]).includes(cid as string)) {
          p.classId = cid as ClassId; // appliqué au prochain respawn
        }
        return;
      }
      default:
        return; // type inconnu : ignoré
    }
  }

  private handleInput(p: ServerPlayer, m: InputData): void {
    if (!isFiniteNum(m.seq) || !isFiniteNum(m.dt) || !isFiniteNum(m.yaw) || !isFiniteNum(m.pitch)) {
      return;
    }
    if (!isFiniteNum(m.keys)) return;
    const keys = Math.floor(m.keys);
    if (keys < 0 || keys > 0xff) return;
    // dt normal = CLIENT_SIM_DT (1/60) ; au-delà de INPUT_DT_ADMIT_MAX la
    // trame est absurde (le budget par tick borne de toute façon la somme).
    if (m.dt <= 0 || m.dt > INPUT_DT_ADMIT_MAX) return;
    if (p.inputs.length >= INPUT_QUEUE_MAX) return; // anti-inondation
    p.inputs.push({
      seq: m.seq,
      dt: m.dt,
      yaw: m.yaw,
      pitch: clampPitch(m.pitch),
      keys,
    });
  }

  private handleShoot(p: ServerPlayer, m: ShootMsg): void {
    if (
      !isFiniteNum(m.seq) ||
      !isFiniteNum(m.ox) ||
      !isFiniteNum(m.oy) ||
      !isFiniteNum(m.oz) ||
      !isFiniteNum(m.dx) ||
      !isFiniteNum(m.dy) ||
      !isFiniteNum(m.dz)
    ) {
      return;
    }
    if (typeof m.ads !== 'boolean') return;
    if (typeof m.weapon !== 'string' || !(m.weapon in WEAPONS)) return;
    // Plombs (fusil à pompe) : entier borné, 1 par défaut (tir simple).
    let pellets = 1;
    if (typeof m.pellets === 'number' && Number.isFinite(m.pellets)) {
      pellets = Math.max(1, Math.min(16, Math.floor(m.pellets)));
    }
    fireShot(this, p, {
      seq: m.seq,
      origin: { x: m.ox, y: m.oy, z: m.oz },
      dir: { x: m.dx, y: m.dy, z: m.dz },
      weapon: m.weapon,
      ads: m.ads,
      pellets,
    });
  }

  // --------------------------------------------------------------------------
  // Arrivées / actions de jeu
  // --------------------------------------------------------------------------

  private addHuman(conn: Conn, name: string, classId: ClassId): void {
    let humans = 0;
    for (const p of this.players.values()) if (!p.bot) humans++;
    if (humans >= MAX_PLAYERS) {
      try {
        conn.ws.close(1008, 'room pleine');
      } catch {
        /* ignoré */
      }
      return;
    }

    const team = pickTeam(this);
    makeRoomForHuman(this, team); // un bot part si l'équipe est pleine
    const p = makePlayer(this.nextId++, name, team, classId, false, this.weapons, this.loadouts[classId]);
    this.players.set(p.id, p);
    conn.playerId = p.id;
    this.conns.set(p.id, conn);

    this.startMatchIfNeeded();
    send(conn.ws, this.buildWelcome(p));
    this.broadcastExcept(p.id, { t: 'ev', kind: 'join', player: playerInfo(p) });
    respawnPlayer(this, p);
    fillWithBots(this); // complète jusqu'à 4v4
  }

  /** Reload : validation (vivant, chargeur non plein, réserve) puis lancement. */
  startReload(p: ServerPlayer): void {
    if (!p.alive) return;
    const now = Date.now();
    const w = currentWeapon(p);
    this.maybeFinishReload(p, w, now);
    const spec = this.weapons[w.id];
    if (w.reloadingUntil > 0) return;
    if (w.mag >= spec.magSize) {
      this.sendTo(p.id, {
        t: 'ev', kind: 'reject', what: 'reload', reason: 'chargeur plein',
        mag: w.mag, reserve: w.reserve,
      });
      return;
    }
    if (w.reserve <= 0) {
      this.sendTo(p.id, {
        t: 'ev', kind: 'reject', what: 'reload', reason: 'réserve vide',
        mag: w.mag, reserve: w.reserve,
      });
      return;
    }
    w.reloadingUntil = now + spec.reloadMs;
  }

  /** Termine un reload arrivé à échéance (idempotent). */
  maybeFinishReload(_p: ServerPlayer, w: WeaponState, now: number): void {
    if (w.reloadingUntil > 0 && now >= w.reloadingUntil) {
      const spec = this.weapons[w.id];
      const need = spec.magSize - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloadingUntil = 0;
    }
  }

  /** Changement d'arme (annule le reload de l'arme quittée). */
  switchSlot(p: ServerPlayer, slot: WeaponSlot): void {
    if (slot === p.slot) return;
    currentWeapon(p).reloadingUntil = 0;
    p.slot = slot;
    p.switchedAt = Date.now();
  }

  /** Activation de l'UAV (coût UAV_COST points personnels, 30 s d'effet). */
  private activateStreak(p: ServerPlayer): void {
    const now = Date.now();
    if (p.streakPoints < UAV_COST) {
      this.sendTo(p.id, { t: 'ev', kind: 'reject', what: 'streak', reason: 'points insuffisants' });
      return;
    }
    if (this.uavUntil[p.team] > now) {
      this.sendTo(p.id, { t: 'ev', kind: 'reject', what: 'streak', reason: 'UAV déjà actif' });
      return;
    }
    p.streakPoints -= UAV_COST;
    this.uavUntil[p.team] = now + UAV_DURATION_S * 1000;
    // Diffusé à l'équipe bénéficiaire uniquement.
    for (const pl of this.players.values()) {
      if (pl.team === p.team) {
        this.sendTo(pl.id, { t: 'ev', kind: 'streak', id: p.id, team: p.team, until: this.uavUntil[p.team] });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Boucle de simulation (30 Hz)
  // --------------------------------------------------------------------------

  private simTick(tickAtMs: number): void {
    const now = Date.now();
    this.tick++;

    // Les bots décident d'abord (leurs inputs sont simulés dans updateBots).
    updateBots(this, now);

    for (const p of this.players.values()) {
      this.maybeFinishReload(p, p.weapons[0], now);
      this.maybeFinishReload(p, p.weapons[1], now);

      if (!p.alive) {
        if (p.respawnAt > 0 && now >= p.respawnAt) {
          respawnPlayer(this, p);
        }
        continue;
      }

      // Consommer la file d'inputs par BUDGET de temps simulé : la somme des
      // dt intégrés ce tick ne dépasse pas INPUT_DT_BUDGET_PER_TICK (lissage
      // de rattrapage) NI le token-bucket long terme (anti speed-hack soutenu
      // — recharge à 1,05× temps réel, plafond DT_BANK_CAP). Le reliquat
      // RESTE EN FILE pour le tick suivant — on ne jette JAMAIS d'input
      // (c'était la cause n°1 du rubber-banding : à 180 FPS, ~1/3 du
      // déplacement du client était détruit ici).
      p.dtBank = Math.min(DT_BANK_CAP, p.dtBank + TICK_DT * 1.05);
      let n = 0;
      let budget = INPUT_DT_BUDGET_PER_TICK;
      while (n < MAX_INPUTS_PER_TICK && p.inputs.length > 0) {
        const inp = p.inputs[0];
        if (inp.seq <= p.lastInputSeq) {
          p.inputs.shift(); // doublon / désordre
          continue;
        }
        const eff = Math.min(inp.dt, DT_MAX); // dt réellement simulé
        if (budget < eff || p.dtBank < eff) break; // budget épuisé : au tick suivant
        p.inputs.shift();
        n++;
        budget -= eff;
        p.dtBank -= eff;
        p.lastInputSeq = inp.seq;
        p.yaw = inp.yaw;
        p.pitch = clampPitch(inp.pitch);
        stepBody(
          p.body,
          { yaw: p.yaw, pitch: p.pitch, keys: inp.keys },
          this.colliders,
          eff,
          this.weapons[p.weapons[p.slot].id].mobility,
        );
      }

      // Régénération : +25 HP/s après 4 s sans dégât.
      if (p.hp < HP_MAX && now - p.lastDamageAt >= REGEN_DELAY_S * 1000) {
        p.hp = Math.min(HP_MAX, p.hp + REGEN_RATE * TICK_DT);
      }

      // Historique de lag compensation (1 état par tick, temps logique du
      // tick — espacé de 33 ms même pendant un rattrapage).
      p.history.push({
        at: tickAtMs,
        x: p.body.pos.x,
        y: p.body.pos.y,
        z: p.body.pos.z,
        height: p.body.height,
      });
    }

    // Timer de partie.
    if (this.phase === 'playing' && now >= this.endsAt) {
      this.endMatch();
    } else if (this.phase === 'end' && now >= this.endsAt) {
      this.resetMatch();
    }
  }

  // --------------------------------------------------------------------------
  // Snapshots (émis en fin de chaque tick — 30 Hz, staleness nulle)
  // --------------------------------------------------------------------------

  private snapshot(): void {
    if (this.conns.size === 0) return;
    const now = Date.now();
    const pl: PlayerSnapshot[] = [];
    for (const p of this.players.values()) {
      pl.push([
        p.id,
        round2(p.body.pos.x),
        round2(p.body.pos.y),
        round2(p.body.pos.z),
        round3(p.yaw),
        round3(p.pitch),
        p.body.stance,
        Math.max(0, Math.round(p.hp)),
        p.slot,
        this.uavUntil[p.team] > now ? STREAK_UAV : 0,
        p.lastInputSeq, // ack : réconciliation client exacte par seq
      ]);
    }
    this.broadcast({ t: 'snap', tick: this.tick, pl });
  }

  // --------------------------------------------------------------------------
  // Phases
  // --------------------------------------------------------------------------

  private startMatchIfNeeded(): void {
    if (this.phase !== 'lobby') return;
    this.phase = 'playing';
    this.endsAt = Date.now() + this.matchDurationS * 1000;
    this.broadcast({ t: 'ev', kind: 'phase', phase: 'playing', endsAt: this.endsAt, winner: -1, stats: [] });
  }

  /** Fin de partie : stats de tous les joueurs (bots inclus), podium 15 s. */
  endMatch(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'end';
    const now = Date.now();
    this.endsAt = now + END_DURATION_S * 1000;
    const [s0, s1] = this.scores;
    const winner: TeamId | -1 = s0 > s1 ? 0 : s1 > s0 ? 1 : -1;
    const stats = [...this.players.values()]
      .map(finalStats)
      .sort((a, b) => b.score - a.score);
    this.broadcast({ t: 'ev', kind: 'phase', phase: 'end', endsAt: this.endsAt, winner, stats });
  }

  /** Nouvelle partie : reset complet puis phase playing. */
  private resetMatch(): void {
    const now = Date.now();
    this.scores = [0, 0];
    this.uavUntil[0] = 0;
    this.uavUntil[1] = 0;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.assists = 0;
      p.score = 0;
      p.streakPoints = 0;
      p.lastShotAt = 0;
      p.lastShotSeq = -1;
      p.lastInputSeq = -1;
      respawnPlayer(this, p); // positions -> spawns, armes fraîches, ev respawn
    }
    this.phase = 'playing';
    this.endsAt = now + this.matchDurationS * 1000;
    this.broadcast({ t: 'ev', kind: 'score', scores: [...this.scores] as TeamScores });
    this.broadcast({ t: 'ev', kind: 'phase', phase: 'playing', endsAt: this.endsAt, winner: -1, stats: [] });
  }

  // --------------------------------------------------------------------------
  // Émission
  // --------------------------------------------------------------------------

  sendTo(id: number, msg: ServerMsg): void {
    const c = this.conns.get(id);
    if (c) send(c.ws, msg);
  }

  broadcast(msg: ServerMsg): void {
    // Sérialisé UNE fois par diffusion (pas une fois par connexion).
    const data = encodeMsg(msg);
    for (const c of this.conns.values()) rawSend(c.ws, data);
  }

  private broadcastExcept(id: number, msg: ServerMsg): void {
    const data = encodeMsg(msg);
    for (const [pid, c] of this.conns) {
      if (pid !== id) rawSend(c.ws, data);
    }
  }

  private buildWelcome(p: ServerPlayer): WelcomeMsg {
    const teams: { team: TeamId; playerIds: number[] }[] = [
      { team: 0, playerIds: [] },
      { team: 1, playerIds: [] },
    ];
    const players: PlayerInfo[] = [];
    for (const pl of this.players.values()) {
      players.push(playerInfo(pl));
      teams[pl.team].playerIds.push(pl.id);
    }
    return {
      t: 'welcome',
      id: p.id,
      tick: this.tick,
      config: {
        ...buildGameConfig(),
        scoreTarget: this.scoreTarget,
        matchDurationS: this.matchDurationS,
        spawnProtectionS: this.spawnProtectionS,
      },
      mapMeta: mapMeta(),
      players,
      teams,
      scores: [...this.scores] as TeamScores,
      phase: this.phase,
      endsAt: this.phase === 'playing' ? this.endsAt : 0,
      mapObjects: this.mapState.objects,
      baseEdits: this.mapState.baseEdits,
      weaponMods: this.mapState.weaponMods ?? {},
      loadouts: this.mapState.loadouts ?? {},
      props: this.mapState.props ?? [],
      baseTerrain: this.mapState.baseTerrain ?? 'kestrel',
    };
  }

  // --------------------------------------------------------------------------
  // Heartbeat ws natif (terminate après 10 s mort) + mesure RTT
  // --------------------------------------------------------------------------

  private heartbeat(): void {
    const now = Date.now();
    for (const conn of this.connByWs.values()) {
      if (now - conn.lastSeenAt > HEARTBEAT_DEAD_MS) {
        try {
          conn.ws.terminate();
        } catch {
          /* ignoré */
        }
        continue;
      }
      conn.lastPingAt = now;
      try {
        conn.ws.ping();
      } catch {
        /* socket mourant : le close nettoiera */
      }
    }
  }
}

/** Conversion robuste des données ws (Buffer / ArrayBuffer / Buffer[]) en texte. */
function rawToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}
