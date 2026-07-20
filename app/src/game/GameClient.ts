// ============================================================================
// STRIKE 2025 — GameClient.ts
// Orchestrateur du moteur (contrat EXACT de design/bridge.md §3) : boucle rAF,
// envoi inputs 30 Hz, application des snapshots (interpolation distants +
// réconciliation locale), tir (dispersion hip/ads interpolée sur adsMs, cadence
// rpm, auto si maintenu, `shoot` avec direction finale), munitions/reload en
// miroir déterministe, événements serveur → actions store selon la table de
// bridge.md, radar ~10 Hz (règle UAV), killcam 2,5 s sur le tueur interpolé,
// réglages du store appliqués en live.
// ============================================================================

import * as THREE from 'three';
import {
  CLIENT_SIM_DT,
  HP_MAX,
  INTERP_DELAY_MS,
  KILLCAM_DURATION_S,
  POINTS_ASSIST,
  POINTS_KILL,
  SHOT_MAX_DIST,
  STREAK_UAV,
  TICK_RATE,
  UAV_COST,
} from '../shared/protocol';
import type {
  ClassId,
  EvKill,
  EvMsg,
  EvPhase,
  EvRespawn,
  EvStreak,
  PlayerInfo,
  PlayerSnapshot,
  ServerMsg,
  SnapMsg,
  TeamId,
  WeaponSlot,
  WelcomeMsg,
} from '../shared/protocol';
import { MAP_COLLIDERS, SPAWNS } from '../shared/map';
import {
  EYE_CROUCH,
  EYE_STAND,
  clampPitch,
  dirFromYawPitch,
  eyeHeight,
  eyePos,
  raycastAABBs,
} from '../shared/sim';
import type { AABB, Vec3 } from '../shared/sim';
import {
  CLASS_DEFS,
  WEAPONS,
  makeWeaponState,
  minShotIntervalMs,
  weaponForSlot,
} from '../shared/weapons';
import type { WeaponState } from '../shared/weapons';
import { useGameUI } from '../ui/store';
import { NetClient } from './net/NetClient';
import { HttpTransport } from './net/HttpTransport';
import type { Transport, TransportCallbacks } from './net/transport';
import { Prediction } from './net/Prediction';
import { Interpolation } from './net/Interpolation';
import type { InterpState } from './net/Interpolation';
import { Renderer } from './render/Renderer';
import { MapBuilder } from './render/MapBuilder';
import { PlayersRenderer } from './render/PlayersRenderer';
import { WeaponView } from './render/WeaponView';
import { loadWeaponModel } from './render/WeaponModels';
import { Effects } from './render/Effects';
import { InputCapture } from './input/InputCapture';
import { AudioEngine } from './audio/AudioEngine';
import { MapEditorController } from './editor/MapEditorController';
import { applyMapState, effectiveBaseBoxes } from '../shared/mapObjects';
import { applyLoadoutsToClient, applyWeaponModsToClient } from '../shared/weaponMods';
import { setWeaponModelMods } from './render/WeaponModels';
import type { BaseTerrain, ClassLoadouts, CustomPropDef, MapBaseEdit, PlacedObject, WeaponModsConfig } from '../shared/protocol';

export type GameClientEvent = 'connected' | 'disconnected' | 'error';

type GameClientCallback = (err?: string) => void;

const COLLIDERS = MAP_COLLIDERS as AABB[];

/** Cadence d'envoi des inputs (ms) — 30 Hz. */
const INPUT_SEND_MS = 33;
/** Cadence de mise à jour du radar/minimap (ms) — ~10 Hz. */
const RADAR_MS = 100;
/** Tolérance cadence côté client (le serveur tolère ×0,9 — on vise ×0,98). */
const FIRE_INTERVAL_MULT = 0.98;

const EMPTY_INTERP: InterpState = {
  x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
  stance: 0, hp: 0, weaponSlot: 0, streakMask: 0, at: 0,
};

export class GameClient {
  private readonly canvas: HTMLCanvasElement;
  private readonly listeners = new Map<GameClientEvent, Set<GameClientCallback>>();

  // Sous-systèmes
  private readonly renderer: Renderer;
  private readonly mapBuilder: MapBuilder;
  private readonly playersRenderer: PlayersRenderer;
  private readonly weaponView: WeaponView;
  private readonly effects: Effects;
  private readonly audio: AudioEngine;
  private readonly input: InputCapture;
  /** Mode BUILD (éditeur de map) — actif quand phase UI === 'editor'. */
  readonly editor: MapEditorController;
  private net: Transport | null = null;
  /** Transport courant : WebSocket d'abord, HTTP de secours si bloqué. */
  private transportKind: 'ws' | 'http' = 'ws';
  /** Vrai une fois le transport ouvert (évite le fallback sur perte réelle). */
  private transportOpened = false;
  /** Salon de la connexion en cours (repris par le fallback HTTP). */
  private connectedRoom: string | null = null;
  private readonly prediction = new Prediction();
  private readonly interpolation = new Interpolation();

  // État de partie
  private welcomed = false;
  private firstSnapSeen = false;
  private myId = -1;
  private myTeam: TeamId = 0;
  private readonly roster = new Map<number, PlayerInfo>();
  private classId: ClassId = 'assault';
  private pendingClass: ClassId | null = null;
  private alive = false;
  private ended = false;
  private myHp = HP_MAX;
  private streakPoints = 0;
  /** Fin d'UAV équipe (timestamp serveur, 0 = inactif). */
  private uavUntil = 0;
  private killcamState: { killerId: number; until: number } | null = null;
  private readonly latestRemote = new Map<number, PlayerSnapshot>();

  // Armes (miroir déterministe du serveur — bridge.md §5.1)
  private weapons: [WeaponState, WeaponState] = [makeWeaponState('vsk27'), makeWeaponState('p9')];
  private slot: WeaponSlot = 0;
  /** Dernier switch LOCAL (ms) — fenêtre de grâce contre le « rollback » du
   *  slot par un snapshot déjà en vol qui porte encore l'ancienne arme. */
  private lastLocalSwitchAt = 0;
  /** Throttle du warn télémétrie de correction de position. */
  private lastCorrWarnAt = 0;
  private lastShotAt = 0;
  private drawUntil = 0;
  private shootSeq = 0;
  private adsT = 0;
  private lastAdsBool = false;

  // Boucle / timers
  private rafId = 0;
  private lastFrameT = 0;
  private lastInputFlushT = 0;
  private lastRadarT = 0;
  private footAcc = 0;
  private menuOrbitT = 0;
  /** Accumulateur du pas de simulation fixe (CLIENT_SIM_DT = 1/60 s). */
  private simAcc = 0;
  /** Horloge de rendu des distants (timeline serveur, DÉJÀ retardée de
   *  INTERP_DELAY_MS) — avance au rythme local, glisse vers le dernier tick. */
  private interpRenderT = 0;
  /** Temps serveur (ms tick) du dernier snapshot reçu. */
  private latestSnapT = 0;

  // Derniers états poussés au store (évite les écritures redondantes)
  private lastAmmoPush = { mag: -1, reserve: -1, slot: -1 as number, reloading: false, endsAt: -1 };

  // Temporaires (zéro allocation par frame)
  private readonly tmpRenderPos = { x: 0, y: 0, z: 0 };
  private readonly tmpInterp: InterpState = { ...EMPTY_INTERP };
  private readonly tmpV1 = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpV3 = new THREE.Vector3();
  private readonly unsubscribeSettings: () => void;

  /**
   * @param canvas  <canvas> plein écran créé dans App.tsx (le moteur y
   *                attache le WebGLRenderer et le pointer lock).
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const settings = useGameUI.getState().settings;

    this.renderer = new Renderer(canvas, settings.quality, settings.fov);
    // La caméra doit être dans le graphe pour que ses enfants (viewmodel,
    // flash light) soient rendus.
    this.renderer.scene.add(this.renderer.camera);
    this.mapBuilder = new MapBuilder();
    this.renderer.scene.add(this.mapBuilder.group);
    this.playersRenderer = new PlayersRenderer(this.renderer.scene);
    this.weaponView = new WeaponView(this.renderer.camera);
    this.weaponView.setVisible(false);
    this.effects = new Effects(this.renderer.scene);
    this.editor = new MapEditorController(this.renderer, this.mapBuilder, canvas);
    // Préchargement des 4 modèles d'armes (évite le à-coup au premier spawn).
    void Promise.all([
      loadWeaponModel('vsk27'),
      loadWeaponModel('kv9'),
      loadWeaponModel('lr50'),
      loadWeaponModel('p9'),
    ]);
    this.audio = new AudioEngine();
    this.input = new InputCapture(canvas, {
      onSwitchSlot: (slot) => this.requestSlot(slot),
      onToggleSlot: () => this.requestSlot(this.slot === 0 ? 1 : 0),
      onReload: () => this.tryReload(),
      onStreak: () => this.activateStreak(),
      onLockChange: () => { /* le jeu continue (pas de phase pause dans le contrat) */ },
    });

    // Réglages live (sensibilité, FOV, volume, qualité).
    this.applySettings();
    this.unsubscribeSettings = useGameUI.subscribe((state, prev) => {
      if (state.settings !== prev.settings) this.applySettings();
    });

    // Déblocage de l'AudioContext au premier geste.
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // Boucle de rendu (tourne aussi au menu : fond 3D vivant derrière l'UI).
    this.lastFrameT = performance.now();
    const loop = (t: number): void => {
      this.rafId = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  // --------------------------------------------------------------------------
  // API publique (bridge.md §3 — signatures EXACTES)
  // --------------------------------------------------------------------------

  /**
   * Ouvre le WebSocket (ws(s)://location.host/ws), envoie `hello`,
   * démarre la boucle de rendu + prédiction. Passe le store en
   * 'connecting' puis 'playing' au premier snapshot. Idempotent :
   * un second appel sans disconnect() est ignoré.
   */
  connect(name: string, classId: ClassId): void {
    if (this.net) {
      // Déjà connecté (ex. REJOUER après fin de match) : applique juste la classe.
      this.setLoadout(classId);
      return;
    }
    const ui = useGameUI.getState();
    ui.engineSetPhase('connecting');
    ui.engineSetConnected(false);
    this.classId = classId;
    this.pendingClass = null;
    this.transportOpened = false;

    const cbs: TransportCallbacks = {
      onOpen: () => {
        this.transportOpened = true;
        this.net?.send({ t: 'hello', name, classId });
      },
      onMessage: (msg) => this.onMessage(msg),
      onClose: (intentional) => this.onTransportClosed(intentional, cbs),
    };

    // Salon ciblé (multi-room) : sélectionné à l'écran COMMUNAUTÉ, sinon main.
    const room = ui.selectedRoom?.id ?? null;
    this.connectedRoom = room;
    // `?transport=http` dans l'URL force le transport de secours (test/debug).
    const forceHttp =
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('transport') === 'http';
    this.transportKind = forceHttp ? 'http' : 'ws';
    this.net = forceHttp ? new HttpTransport(cbs, room) : new NetClient(cbs, room);
    this.net.connect();
  }

  /** Fermeture du transport : bascule HTTP si le WebSocket n'a jamais
   *  réussi à s'ouvrir (proxy bloquant l'upgrade), sinon perte réelle. */
  private onTransportClosed(intentional: boolean, cbs: TransportCallbacks): void {
    if (!intentional && !this.transportOpened && this.transportKind === 'ws') {
      console.warn('[net] WebSocket impossible — bascule sur le transport HTTP de secours');
      this.transportKind = 'http';
      this.net = new HttpTransport(cbs, this.connectedRoom);
      this.net.connect();
      const ui = useGameUI.getState();
      ui.engineAddAnnouncement('WEBSOCKET BLOQUÉ — MODE COMPATIBILITÉ HTTP', 'info');
      return;
    }
    this.onConnectionClosed(intentional);
  }

  /**
   * Ferme proprement (socket, pointer lock, boucle). Le store repasse
   * en 'menu'. Sûr à appeler même si non connecté.
   */
  disconnect(): void {
    if (this.net) {
      this.net.close();
      this.net = null;
    }
    this.teardownMatch();
    const ui = useGameUI.getState();
    ui.engineSetConnected(false);
    ui.engineSetPhase('menu');
    this.emit('disconnected');
  }

  /**
   * Change de classe. En vie : mémorisé et appliqué au PROCHAIN respawn
   * (le serveur impose la classe au respawn). En phase 'dead' : pris en
   * compte immédiatement pour le respawn imminent. Met aussi à jour
   * store.classId.
   */
  setLoadout(classId: ClassId): void {
    useGameUI.getState().setClassId(classId);
    if (classId !== this.classId) {
      this.pendingClass = classId;
    }
    // Informe le serveur (il impose la classe au prochain respawn).
    if (this.net && this.welcomed) {
      this.net.send({ t: 'setClass', classId });
    }
  }

  /** Demande d'activation de l'UAV (touche « 4 »). Le moteur envoie
   *  `streak` si store.streakPoints >= UAV_COST, sinon annonce
   *  « Streak insuffisant ». */
  activateStreak(): void {
    const ui = useGameUI.getState();
    if (!this.welcomed || !this.net) return;
    if (ui.streakPoints >= UAV_COST) {
      this.net.send({ t: 'streak' });
    } else {
      ui.engineAddAnnouncement(
        `Streak insuffisant — ${ui.streakPoints}/${UAV_COST} points`,
        'streak',
      );
    }
  }

  /** Abonnement minimal aux événements de cycle de vie. */
  on(event: GameClientEvent, cb: (err?: string) => void): void {
    let setForEvent = this.listeners.get(event);
    if (!setForEvent) {
      setForEvent = new Set();
      this.listeners.set(event, setForEvent);
    }
    setForEvent.add(cb);
  }

  off(event: GameClientEvent, cb: (err?: string) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  private emit(event: GameClientEvent, err?: string): void {
    const setForEvent = this.listeners.get(event);
    if (!setForEvent) return;
    for (const cb of setForEvent) {
      try {
        cb(err);
      } catch {
        /* un listener ne doit jamais casser la boucle */
      }
    }
  }

  // --------------------------------------------------------------------------
  // Messages serveur → store (table de correspondance de bridge.md §3)
  // --------------------------------------------------------------------------

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.onWelcome(msg);
        break;
      case 'snap':
        this.onSnap(msg);
        break;
      case 'ev':
        this.onEvent(msg);
        break;
      case 'pong':
        if (this.net) {
          const ui = useGameUI.getState();
          ui.engineSetPing(Math.round(this.net.rttMs));
          ui.engineSetServerOffset(Math.round(this.net.serverOffsetMs));
        }
        break;
      case 'mapObjects':
        // Édition de map mise à jour (sauvegarde d'un éditeur) : visuel +
        // collisions + mods d'armes, en direct même en pleine partie.
        this.applyMapObjects(msg.objects, msg.baseEdits ?? [], msg.props ?? [], msg.baseTerrain ?? 'kestrel');
        if (msg.weaponMods) this.applyWeaponMods(msg.weaponMods, msg.loadouts ?? {});
        break;
      default:
        break;
    }
  }

  /** Applique l'état d'édition de map : rendu (terrain + boîtes de base
   *  éditées + objets/props placés) + collisions partagées (mutation en
   *  place — sim, raycasts et tirs les voient). */
  private applyMapObjects(
    objects: PlacedObject[],
    baseEdits: MapBaseEdit[] = [],
    props: CustomPropDef[] = [],
    baseTerrain: BaseTerrain = 'kestrel',
  ): void {
    const state = { objects, baseEdits, props, baseTerrain };
    applyMapState(state);
    this.mapBuilder.setTerrain(baseTerrain);
    this.mapBuilder.setBaseBoxes(effectiveBaseBoxes(state));
    this.mapBuilder.setCustomObjects(objects, props);
  }

  /** Applique les mods d'armes du salon : stats (miroir de prédiction, HUD,
   *  cadence) + modèles 3D custom (viewmodel + avatars distants). */
  private applyWeaponMods(mods: WeaponModsConfig, loadouts: ClassLoadouts = {}): void {
    applyWeaponModsToClient(mods);
    applyLoadoutsToClient(loadouts);
    const changed = setWeaponModelMods(mods);
    if (changed.length > 0) {
      this.weaponView.refreshModel();
      this.playersRenderer.refreshGuns();
    }
  }

  private onWelcome(msg: WelcomeMsg): void {
    const me = msg.players.find((p) => p.id === msg.id);
    this.myId = msg.id;
    this.myTeam = me ? me.team : 0;
    this.roster.clear();
    for (const p of msg.players) this.roster.set(p.id, p);
    this.playersRenderer.setRoster(msg.players);
    this.interpolation.clear();
    this.latestRemote.clear();
    this.latestSnapT = 0;
    this.interpRenderT = 0;
    this.simAcc = 0;
    // État d'édition de map autoritaire (visuel + collisions) + mods d'armes
    // du salon (AVANT resetWeapons — les chargeurs en dépendent).
    if (msg.mapObjects) {
      this.applyMapObjects(msg.mapObjects, msg.baseEdits ?? [], msg.props ?? [], msg.baseTerrain ?? 'kestrel');
    }
    this.applyWeaponMods(msg.weaponMods ?? {}, msg.loadouts ?? {});

    // Position locale temporaire (corrigée par le premier snapshot/respawn).
    const sp = SPAWNS[this.myTeam][0];
    this.prediction.reset(sp.x, sp.y, sp.z, sp.yaw);
    this.input.yaw = sp.yaw;
    this.input.pitch = 0;

    this.resetWeapons();
    this.streakPoints = 0;
    this.uavUntil = 0;
    this.killcamState = null;
    this.alive = true;
    this.weaponView.setVisible(true);
    this.myHp = HP_MAX;
    this.ended = msg.phase === 'end';
    this.welcomed = true;
    this.firstSnapSeen = false;
    this.input.enabled = true;

    const ui = useGameUI.getState();
    ui.engineSetWelcome(msg.id, this.myTeam, msg.players, msg.scores, msg.endsAt);
    ui.engineSetConnected(true);
    ui.engineSetVitals(HP_MAX);
    ui.engineSetStreak(0, 0);
    this.pushAmmo();
    this.audio.unlock();
    this.audio.startAmbience();
    this.emit('connected');
  }

  private onSnap(msg: SnapMsg): void {
    const nowMs = Date.now();
    // Timeline serveur : le tick date le snapshot indépendamment du jitter de
    // réception (l'horloge de rendu interpRenderT glisse vers cette cible).
    const tickMs = msg.tick * (1000 / TICK_RATE);
    if (this.latestSnapT === 0) {
      // Premier snapshot : cale l'horloge de rendu directement.
      this.interpRenderT = tickMs - INTERP_DELAY_MS;
    }
    this.latestSnapT = tickMs;
    let mySnap: PlayerSnapshot | null = null;
    for (const p of msg.pl) {
      if (p[0] === this.myId) {
        mySnap = p;
      } else {
        this.interpolation.push(p, tickMs);
        this.latestRemote.set(p[0], p);
      }
    }
    if (!mySnap) return;

    const ui = useGameUI.getState();
    if (!this.firstSnapSeen) {
      this.firstSnapSeen = true;
      ui.engineSetPhase('playing');
    }
    // Réconciliation locale exacte par ack (rewind + replay si divergence).
    // Télémétrie : toute correction de la position de RENDU > 8 cm est loguée
    // (throttlée) — c'est un rollback perçu, il doit rester exceptionnel.
    const alpha = this.simAcc / CLIENT_SIM_DT;
    this.prediction.renderPos(this.tmpRenderPos, alpha);
    const rbx = this.tmpRenderPos.x;
    const rby = this.tmpRenderPos.y;
    const rbz = this.tmpRenderPos.z;
    this.prediction.reconcile(mySnap, alpha);
    this.prediction.renderPos(this.tmpRenderPos, alpha);
    const corr = Math.hypot(this.tmpRenderPos.x - rbx, this.tmpRenderPos.y - rby, this.tmpRenderPos.z - rbz);
    if (corr > 0.08 && nowMs - this.lastCorrWarnAt > 1000) {
      this.lastCorrWarnAt = nowMs;
      console.warn(
        `[netcode] correction de position ${corr.toFixed(2)} m (ack ${mySnap[10]}) — signaler si fréquent`,
      );
    }

    // Vitals depuis le snapshot (autoritaire).
    const hp = mySnap[7];
    if (hp !== this.myHp) {
      this.myHp = hp;
      ui.engineSetVitals(hp);
    }
    // Slot d'arme autoritaire (correction serveur éventuelle) — IGNORÉE
    // pendant la fenêtre qui suit un switch local : les snapshots déjà en vol
    // portent encore l'ancien slot et annulaient le changement d'arme
    // (« rollback » d'arme visible) avant que le serveur ne l'enregistre.
    const wslot = mySnap[8];
    if (wslot !== this.slot && nowMs - this.lastLocalSwitchAt > 800) {
      this.applySlot(wslot, false);
    }
    // UAV équipe via streakMask bit0 (join en cours d'UAV : borne basse).
    if ((mySnap[9] & STREAK_UAV) !== 0) {
      const serverNow = this.net ? this.net.serverNow() : nowMs;
      if (this.uavUntil < serverNow + 500) {
        this.uavUntil = serverNow + 500;
      }
    }
  }

  private onEvent(ev: EvMsg): void {
    const ui = useGameUI.getState();
    switch (ev.kind) {
      case 'hit':
        // Touché confirmé (je suis le tireur) : hitmarker blanc + son + puff
        // sombre sur la cible touchée.
        ui.engineAddHitmarker('hit', ev.head);
        this.audio.hit();
        this.effects.bloodPuff(this.playerChestPos(ev.targetId));
        break;

      case 'damage': {
        // Dégât subi : vitals + indicateur directionnel depuis l'attaquant.
        this.myHp = ev.hp;
        ui.engineSetVitals(ev.hp);
        ui.engineAddDamageIndicator(this.relYawFrom(ev.fromId));
        this.audio.hit();
        this.remoteShotFx(ev.fromId, this.myEyePos());
        break;
      }

      case 'kill':
        this.onKill(ev);
        break;

      case 'respawn':
        this.onRespawn(ev);
        break;

      case 'score':
        ui.engineSetScores(ev.scores);
        break;

      case 'streak':
        this.onStreak(ev);
        break;

      case 'phase':
        this.onPhase(ev);
        break;

      case 'join':
        this.roster.set(ev.player.id, ev.player);
        this.playersRenderer.addPlayer(ev.player);
        ui.engineUpsertBoard(ev.player.id, {
          name: ev.player.name,
          team: ev.player.team,
          bot: ev.player.bot,
          kills: 0,
          deaths: 0,
          assists: 0,
          score: 0,
        });
        break;

      case 'leave':
        this.roster.delete(ev.id);
        this.playersRenderer.removePlayer(ev.id);
        this.interpolation.remove(ev.id);
        this.latestRemote.delete(ev.id);
        ui.engineRemoveFromBoard(ev.id);
        break;

      case 'reject':
        ui.engineAddAnnouncement(ev.reason, 'info');
        if (ev.what === 'reload') {
          this.cancelReload();
          // Resync du miroir munitions sur l'état autoritaire (un tir mangé
          // par la gigue réseau peut avoir désynchronisé le chargeur).
          if (typeof ev.mag === 'number' && typeof ev.reserve === 'number') {
            const ws = this.weapons[this.slot];
            ws.mag = ev.mag;
            ws.reserve = ev.reserve;
            this.pushAmmo();
          }
        }
        break;

      default:
        break;
    }
  }

  private onKill(ev: EvKill): void {
    const ui = useGameUI.getState();
    const killer = this.roster.get(ev.killerId);
    const victim = this.roster.get(ev.victimId);

    ui.engineAddKillfeed({
      killerName: killer?.name ?? 'Inconnu',
      victimName: victim?.name ?? 'Inconnu',
      killerTeam: killer?.team ?? 0,
      victimTeam: victim?.team ?? 0,
      weapon: ev.weapon,
      head: ev.head,
    });
    ui.engineSetScores(ev.scores);

    // Board (K/D/A + score dérivés — bridge.md §5.2).
    const board = ui.board;
    const kb = board[ev.killerId];
    ui.engineUpsertBoard(ev.killerId, {
      kills: (kb?.kills ?? 0) + 1,
      score: (kb?.score ?? 0) + POINTS_KILL,
    });
    const vb = board[ev.victimId];
    ui.engineUpsertBoard(ev.victimId, { deaths: (vb?.deaths ?? 0) + 1 });
    let streakChanged = false;
    for (const aid of ev.assistIds) {
      const ab = board[aid];
      ui.engineUpsertBoard(aid, {
        assists: (ab?.assists ?? 0) + 1,
        score: (ab?.score ?? 0) + POINTS_ASSIST,
      });
      if (aid === this.myId) {
        this.streakPoints += POINTS_ASSIST;
        streakChanged = true;
      }
    }

    if (ev.killerId === this.myId) {
      // Moi tueur : hitmarker rouge + son kill + points de streak.
      ui.engineAddHitmarker('kill', ev.head);
      this.audio.kill();
      this.streakPoints += POINTS_KILL;
      streakChanged = true;
    }
    if (streakChanged) {
      ui.engineSetStreak(this.streakPoints, this.uavUntil);
    }

    if (ev.victimId === this.myId) {
      // Moi victime : killcam 2,5 s sur le tueur + phase 'dead'.
      this.alive = false;
      this.weaponView.setVisible(false);
      this.myHp = 0;
      this.cancelReload();
      this.input.resetTransient();
      // Curseur libéré : l'écran de mort a des boutons cliquables
      // ([C] changer de classe). Re-verrouillé au respawn.
      this.input.releaseLock();
      this.adsT = 0;
      if (this.lastAdsBool) {
        this.lastAdsBool = false;
        ui.engineSetAds(false);
      }
      ui.engineSetVitals(0);
      const until = Date.now() + KILLCAM_DURATION_S * 1000;
      this.killcamState = { killerId: ev.killerId, until };
      ui.engineSetKillcam({
        killerId: ev.killerId,
        killerName: killer?.name ?? 'Inconnu',
        weapon: ev.weapon,
        until,
      });
      ui.engineSetPhase('dead');
    }

    // Fx du tir distant (muzzle flash chez le tueur + tracante) — pas pour mes
    // propres tirs (déjà rendus localement). Puff sombre sur la victime.
    const victimPos = this.playerChestPos(ev.victimId);
    this.effects.bloodPuff(victimPos);
    if (ev.killerId !== this.myId) {
      this.remoteShotFx(ev.killerId, victimPos, ev.weapon);
    }
  }

  private onRespawn(ev: EvRespawn): void {
    if (ev.id !== this.myId) return;
    // Classe différée appliquée au respawn (bridge.md §5.4).
    if (this.pendingClass !== null) {
      this.classId = this.pendingClass;
      this.pendingClass = null;
    }
    this.resetWeapons();
    this.prediction.reset(ev.x, ev.y, ev.z, ev.yaw);
    this.input.yaw = ev.yaw;
    this.input.pitch = 0;
    // Purge les clics accumulés pendant la mort (pas de tir accidentel).
    this.input.resetTransient();
    this.alive = true;
    this.weaponView.setVisible(true);
    this.myHp = HP_MAX;
    this.killcamState = null;

    const ui = useGameUI.getState();
    ui.engineSetKillcam(null);
    ui.engineSetVitals(HP_MAX);
    this.pushAmmo();
    ui.engineSetPhase('playing');
    // Reprise du pointer lock (la sortie à la mort était programmatique —
    // Chromium l'autorise sans nouveau geste utilisateur).
    this.input.requestLock();
  }

  private onStreak(ev: EvStreak): void {
    if (ev.team !== this.myTeam) return;
    this.uavUntil = ev.until;
    if (ev.id === this.myId) {
      this.streakPoints = Math.max(0, this.streakPoints - UAV_COST);
    }
    const ui = useGameUI.getState();
    ui.engineSetStreak(this.streakPoints, ev.until);
    ui.engineAddAnnouncement('UAV allié en ligne', 'streak');
    this.audio.uav();
  }

  private onPhase(ev: EvPhase): void {
    const ui = useGameUI.getState();
    if (ev.phase === 'end') {
      this.ended = true;
      const offset = this.net ? this.net.serverOffsetMs : 0;
      ui.engineSetResults({
        winner: ev.winner,
        scores: [ui.scores[0], ui.scores[1]],
        stats: ev.stats,
        returnAt: ev.endsAt - offset,
      });
      ui.engineSetPhase('end');
    } else if (ev.phase === 'playing') {
      // Nouvelle partie : reset complet (le prochain snapshot replace le corps).
      this.ended = false;
      this.alive = true;
      this.weaponView.setVisible(true);
      this.myHp = HP_MAX;
      this.streakPoints = 0;
      this.uavUntil = 0;
      this.killcamState = null;
      ui.engineResetMatchState();
      ui.engineSetMatchEndsAt(ev.endsAt);
      this.resetWeapons();
      this.pushAmmo();
      ui.engineSetStreak(0, 0);
      ui.engineSetVitals(HP_MAX);
      ui.engineSetPhase('playing');
    }
  }

  /** Perte de connexion : retour phase menu avec annonce FR. */
  private onConnectionClosed(intentional: boolean): void {
    if (intentional) return;
    const wasConnecting = useGameUI.getState().phase === 'connecting';
    this.net = null;
    this.teardownMatch();
    const ui = useGameUI.getState();
    const reason = wasConnecting
      ? 'Connexion au serveur impossible'
      : 'Connexion perdue avec le serveur';
    ui.engineSetConnected(false, reason);
    ui.engineAddAnnouncement(`${reason} — retour au menu`, 'phase');
    ui.engineSetPhase('menu');
    this.emit('error', reason);
    this.emit('disconnected');
    // Auto-diagnostic affiché dans le menu : sonde HTTP du serveur de jeu.
    // « sonde HTTP 200 » = serveur joignable (le blocage vient du transport) ;
    // « sonde HTTP KO » = serveur injoignable (conteneur arrêté / proxy).
    if (wasConnecting) {
      const kind = this.transportKind;
      void fetch('/healthz', { cache: 'no-store' })
        .then((r) => {
          useGameUI
            .getState()
            .engineSetConnected(
              false,
              `${reason} · transport ${kind === 'http' ? 'WS+HTTP' : 'WS'} · sonde HTTP ${r.status}`,
            );
        })
        .catch(() => {
          useGameUI
            .getState()
            .engineSetConnected(
              false,
              `${reason} · transport ${kind === 'http' ? 'WS+HTTP' : 'WS'} · sonde HTTP KO (serveur injoignable)`,
            );
        });
    }
  }

  /** Réinitialise tout l'état de match (déconnexion ou perte réseau). */
  private teardownMatch(): void {
    this.welcomed = false;
    this.firstSnapSeen = false;
    this.alive = false;
    this.ended = false;
    this.myId = -1;
    this.myHp = HP_MAX;
    this.streakPoints = 0;
    this.uavUntil = 0;
    this.killcamState = null;
    this.pendingClass = null;
    this.adsT = 0;
    this.lastAdsBool = false;
    this.roster.clear();
    this.latestRemote.clear();
    this.interpolation.clear();
    this.latestSnapT = 0;
    this.interpRenderT = 0;
    this.simAcc = 0;
    this.playersRenderer.clearAll();
    this.input.enabled = false;
    this.input.resetTransient();
    this.input.releaseLock();
    this.weaponView.setVisible(false);
    this.weaponView.cancelReload();
    this.audio.stopAmbience();
    this.lastAmmoPush = { mag: -1, reserve: -1, slot: -1, reloading: false, endsAt: -1 };
  }

  // --------------------------------------------------------------------------
  // Boucle principale (rAF)
  // --------------------------------------------------------------------------

  private frame(t: number): void {
    const dt = Math.min(0.1, Math.max(0, (t - this.lastFrameT) / 1000));
    this.lastFrameT = t;
    const nowMs = Date.now();
    const phase = useGameUI.getState().phase;

    // Sortie propre du mode éditeur dès que la phase change.
    if (phase !== 'editor' && this.editor.active) this.editor.exit();

    if (this.welcomed && (phase === 'playing' || phase === 'dead' || phase === 'end')) {
      this.input.enabled = phase !== 'end';

      // 1. Regard souris → prédiction yaw/pitch.
      this.input.consumeLook();
      this.prediction.yaw = this.input.yaw;
      this.prediction.pitch = this.input.pitch;

      // 2. Prédiction locale à PAS FIXE (même stepBody que le serveur, même
      //    découpage du temps : 60 inputs/s quel que soit le FPS — le serveur
      //    n'est jamais saturé et la réconciliation est bit-identique).
      if (this.alive && !this.ended && phase === 'playing') {
        this.prediction.speedMult = WEAPONS[this.weapons[this.slot].id].mobility;
        this.simAcc += dt;
        // Rattrapage borné (onglet en arrière-plan) : max 8 pas par frame.
        if (this.simAcc > CLIENT_SIM_DT * 8) this.simAcc = CLIENT_SIM_DT * 8;
        const keys = this.input.computeKeys();
        while (this.simAcc >= CLIENT_SIM_DT) {
          this.simAcc -= CLIENT_SIM_DT;
          this.prediction.step(CLIENT_SIM_DT, keys);
        }
      } else {
        this.simAcc = 0;
      }
      this.prediction.updateSmoothing(dt);

      // 3. Flush des inputs à 30 Hz (UN message batché par flush).
      if (t - this.lastInputFlushT >= INPUT_SEND_MS) {
        this.lastInputFlushT = t;
        this.flushInputs();
      }

      // 3bis. Horloge de rendu des distants : avance au rythme local, glisse
      // doucement vers `dernier tick - INTERP_DELAY_MS` (résorbe la dérive
      // d'horloge et le jitter sans à-coups).
      if (this.latestSnapT > 0) {
        this.interpRenderT += dt * 1000;
        const target = this.latestSnapT - INTERP_DELAY_MS;
        const drift = target - this.interpRenderT;
        if (drift > 250) {
          this.interpRenderT = target; // très en retard (retour d'onglet) : resync dur
        } else if (drift > 0) {
          this.interpRenderT += drift * Math.min(1, dt * 3); // rattrapage doux
        } else {
          // Trou de snapshots : on avance jusqu'au budget d'extrapolation puis
          // on GÈLE (jamais de resync arrière — pas de dents de scie).
          this.interpRenderT = Math.min(this.interpRenderT, target + 120);
        }
      }

      // 4. Caméra (joueur prédit ou killcam) — AVANT les armes pour que les
      // fx de tir (muzzle world) partent de la pose caméra de CETTE frame.
      if (!this.alive && this.killcamState) {
        this.updateKillcam(nowMs);
      } else {
        this.updatePlayerCamera();
      }

      // 5. Armes (reload, tir, ADS).
      this.updateWeapons(t, dt);

      // 6. Joueurs distants interpolés.
      this.updateRemotes(nowMs, dt);

      // 7. Viewmodel + pas.
      this.updateViewmodel(dt);

      // 8. Radar ~10 Hz.
      if (t - this.lastRadarT >= RADAR_MS) {
        this.lastRadarT = t;
        this.pushRadar();
      }
    } else if (phase === 'editor') {
      // Mode BUILD : caméra libre + placement (le contrôleur pilote la caméra).
      if (!this.editor.active) this.editor.enter();
      this.input.enabled = false;
      this.weaponView.setVisible(false);
      this.editor.update(dt);
    } else {
      // Menu / connecting : orbite lente autour de la map (fond vivant).
      this.updateMenuOrbit(dt);
    }

    this.mapBuilder.update(t / 1000);
    this.effects.update(performance.now(), dt);
    this.renderer.render();
  }

  private flushInputs(): void {
    if (!this.net || !this.net.connected) return;
    const unsent = this.prediction.drainUnsent();
    if (unsent.length === 0) return;
    const nowMs = Date.now();
    // UN message par flush (au lieu d'un par input) : framing/parse divisés
    // d'autant, arrivée lissée sur les ticks serveur.
    this.net.send({
      t: 'inputs',
      list: unsent.map((input) => ({
        seq: input.seq,
        dt: input.dt,
        yaw: input.yaw,
        pitch: input.pitch,
        keys: input.keys,
      })),
    });
    for (const input of unsent) input.sentAt = nowMs;
  }

  // --------------------------------------------------------------------------
  // Armes : cadence, dispersion, recul, reload, switch (miroir déterministe)
  // --------------------------------------------------------------------------

  private updateWeapons(t: number, dt: number): void {
    const ws = this.weapons[this.slot];
    const spec = WEAPONS[ws.id];

    // Fin de reload (miroir).
    if (ws.reloadingUntil !== 0 && t >= ws.reloadingUntil) {
      const take = Math.min(spec.magSize - ws.mag, ws.reserve);
      ws.mag += take;
      ws.reserve -= take;
      ws.reloadingUntil = 0;
      this.pushAmmo();
    }

    // ADS lissé sur adsMs (annulé pendant un reload).
    const wantAds =
      this.alive && !this.ended && this.input.adsHeld && ws.reloadingUntil === 0;
    const rate = spec.adsMs > 0 ? dt / (spec.adsMs / 1000) : 1;
    this.adsT = THREE.MathUtils.clamp(this.adsT + (wantAds ? rate : -rate), 0, 1);
    const adsBool = this.adsT > 0.5;
    if (adsBool !== this.lastAdsBool) {
      this.lastAdsBool = adsBool;
      useGameUI.getState().engineSetAds(adsBool);
    }

    // FOV : base × adsFovMult interpolé.
    const eased = this.adsT * this.adsT * (3 - 2 * this.adsT);
    this.renderer.setFov(this.renderer.baseFov * (1 + (spec.adsFovMult - 1) * eased));

    if (!this.alive || this.ended) return;

    // Tir : auto si maintenu, semi sur front montant.
    if (this.input.fireHeld && spec.auto) {
      this.tryFire(t);
    } else if (this.input.consumeFireEdge()) {
      if (ws.mag <= 0) {
        this.audio.dryFire();
        this.tryReload();
      } else {
        this.tryFire(t);
      }
    }
  }

  private tryFire(t: number): void {
    const ws = this.weapons[this.slot];
    const spec = WEAPONS[ws.id];
    if (ws.reloadingUntil !== 0) return;
    if (t < this.drawUntil) return;
    if (t - this.lastShotAt < minShotIntervalMs(spec.id) * FIRE_INTERVAL_MULT) return;
    if (ws.mag <= 0) {
      this.audio.dryFire();
      this.tryReload();
      return;
    }
    ws.mag -= 1;
    this.lastShotAt = t;

    // Direction finale avec dispersion (hip/ads interpolée sur adsT).
    const spreadDeg = spec.spread.hip + (spec.spread.ads - spec.spread.hip) * this.adsT;
    const dir = this.spreadDir(this.input.yaw, this.input.pitch, spreadDeg);
    const eye = eyePos(this.prediction.body);

    // Envoi au serveur (le serveur valide cadence/munitions/origine).
    this.net?.send({
      t: 'shoot',
      seq: this.shootSeq++,
      ox: eye.x,
      oy: eye.y,
      oz: eye.z,
      dx: dir.x,
      dy: dir.y,
      dz: dir.z,
      weapon: spec.id,
      ads: this.adsT > 0.5,
    });

    // Recul caméra (degrés → radians, §7 : transmis au serveur via les inputs
    // suivants — cohérent, pas de double comptage).
    this.input.pitch = clampPitch(this.input.pitch + (spec.recoil.vertical * Math.PI) / 180);
    this.input.yaw += ((Math.random() * 2 - 1) * spec.recoil.horizontal * Math.PI) / 180;

    // Effets locaux : kick viewmodel, flash, tracante + impact (visuel — le
    // serveur seul décide des touches).
    this.weaponView.kick(spec.recoil.vertical);
    this.weaponView.muzzleFlash();
    // Origine écran des fx monde : la bouche du canon est dessinée par la
    // caméra viewmodel (FOV fixe) — on reprojette sa position pour que
    // tracante/étui partent du même point À L'ÉCRAN pour la caméra monde.
    this.weaponView.getMuzzleWorld(this.tmpV1);
    this.renderer.viewmodelToWorld(this.tmpV1, 0.9, this.tmpV1);
    // Étui éjecté (direction droite de la caméra).
    this.tmpV2.set(1, 0, 0).applyQuaternion(this.renderer.camera.quaternion);
    this.effects.ejectCasing(this.tmpV1, this.tmpV2);
    const hit = raycastAABBs(eye, dir, COLLIDERS, SHOT_MAX_DIST);
    this.tmpV2.set(dir.x, dir.y, dir.z);
    if (hit) {
      this.tmpV3.set(hit.point.x, hit.point.y, hit.point.z);
      this.effects.impact(hit.point, hit.normal);
      this.effects.impactDecal(hit.point, hit.normal);
    } else {
      this.tmpV3
        .copy(this.tmpV2)
        .multiplyScalar(SHOT_MAX_DIST)
        .add(this.tmpV1.set(eye.x, eye.y, eye.z));
    }
    this.weaponView.getMuzzleWorld(this.tmpV1);
    this.renderer.viewmodelToWorld(this.tmpV1, 0.9, this.tmpV1);
    this.effects.tracer(this.tmpV1, this.tmpV3);
    this.audio.shot(spec.id, 0);
    this.pushAmmo();
  }

  private tryReload(): void {
    if (!this.alive || this.ended) return;
    const ws = this.weapons[this.slot];
    const spec = WEAPONS[ws.id];
    const now = performance.now();
    if (ws.reloadingUntil !== 0) return;
    if (ws.mag >= spec.magSize || ws.reserve <= 0) return;
    ws.reloadingUntil = now + spec.reloadMs;
    this.net?.send({ t: 'reload' });
    this.weaponView.startReload(spec.reloadMs);
    this.audio.reload();
    this.pushAmmo();
  }

  private cancelReload(): void {
    for (const ws of this.weapons) {
      ws.reloadingUntil = 0;
    }
    this.weaponView.cancelReload();
    this.pushAmmo();
  }

  /** Switch demandé par le joueur (touche 1/2 ou molette). */
  private requestSlot(slot: WeaponSlot): void {
    if (!this.welcomed || !this.alive || this.ended) return;
    this.lastLocalSwitchAt = Date.now();
    this.applySlot(slot, true);
  }

  /** Applique un slot (notify=true → envoie `switch` au serveur). */
  private applySlot(slot: WeaponSlot, notify: boolean): void {
    if (slot === this.slot) return;
    this.slot = slot;
    // Le switch annule le reload en cours (miroir déterministe).
    this.weapons[0].reloadingUntil = 0;
    this.weapons[1].reloadingUntil = 0;
    this.weaponView.cancelReload();
    this.drawUntil = performance.now() + WEAPONS[this.weapons[slot].id].drawMs;
    this.weaponView.setWeapon(this.weapons[slot].id);
    this.audio.switchClick();
    if (notify) {
      this.net?.send({ t: 'switch', slot });
    }
    this.pushAmmo();
  }

  /** Armes pleines de la classe courante (respawn / nouvelle partie).
   *  NB : shootSeq n'est JAMAIS remis à zéro — le serveur conserve
   *  lastShotSeq à travers les respawns (anti-rejeu) : un compteur remis à
   *  zéro ferait rejeter silencieusement tous les tirs des vies suivantes. */
  private resetWeapons(): void {
    const loadout = CLASS_DEFS[this.classId].loadout;
    this.weapons = [makeWeaponState(loadout[0]), makeWeaponState(loadout[1])];
    this.slot = 0;
    this.lastShotAt = 0;
    this.drawUntil = 0;
    this.adsT = 0;
    this.weaponView.setWeapon(loadout[0]);
  }

  /** Pousse l'état d'arme miroir vers le HUD (uniquement si changé). */
  private pushAmmo(): void {
    const ws = this.weapons[this.slot];
    const reloading = ws.reloadingUntil !== 0;
    const endsAt = reloading
      ? Date.now() + Math.max(0, ws.reloadingUntil - performance.now())
      : 0;
    const last = this.lastAmmoPush;
    if (
      last.mag === ws.mag &&
      last.reserve === ws.reserve &&
      last.slot === this.slot &&
      last.reloading === reloading &&
      last.endsAt === endsAt
    ) {
      return;
    }
    this.lastAmmoPush = { mag: ws.mag, reserve: ws.reserve, slot: this.slot, reloading, endsAt };
    useGameUI.getState().engineSetAmmo(ws.mag, ws.reserve, this.slot, reloading, endsAt);
  }

  /** Direction avec dispersion conique (degrés, cône plein uniforme). */
  private spreadDir(yaw: number, pitch: number, spreadDeg: number): Vec3 {
    const base = dirFromYawPitch(yaw, pitch);
    if (spreadDeg <= 0.0001) return base;
    const maxAngle = (spreadDeg * Math.PI) / 180;
    const a = Math.random() * Math.PI * 2;
    const r = maxAngle * Math.sqrt(Math.random());
    const offX = Math.cos(a) * Math.tan(r);
    const offY = Math.sin(a) * Math.tan(r);
    // Base orthonormale autour de `base`.
    const b = this.tmpV1.set(base.x, base.y, base.z);
    const up = Math.abs(b.y) > 0.95 ? this.tmpV2.set(1, 0, 0) : this.tmpV2.set(0, 1, 0);
    const right = this.tmpV3.crossVectors(b, up).normalize();
    const up2 = new THREE.Vector3().crossVectors(right, b).normalize();
    return {
      x: base.x + right.x * offX + up2.x * offY,
      y: base.y + right.y * offX + up2.y * offY,
      z: base.z + right.z * offX + up2.z * offY,
    };
  }

  // --------------------------------------------------------------------------
  // Caméra : joueur prédit / killcam / orbite menu
  // --------------------------------------------------------------------------

  private updatePlayerCamera(): void {
    this.prediction.renderPos(this.tmpRenderPos, this.simAcc / CLIENT_SIM_DT);
    const cam = this.renderer.camera;
    cam.position.set(
      this.tmpRenderPos.x,
      this.tmpRenderPos.y + eyeHeight(this.prediction.body.height),
      this.tmpRenderPos.z,
    );
    cam.rotation.set(this.input.pitch, this.input.yaw, 0);
  }

  /** Killcam : caméra spectatrice épaule sur le tueur interpolé (2,5 s). */
  private updateKillcam(_nowMs: number): void {
    const kc = this.killcamState;
    if (!kc) return;
    const s = this.tmpInterp;
    if (!this.interpolation.sample(kc.killerId, this.interpRenderT, s)) {
      // Tueur inconnu (leave ?) : rester sur la caméra joueur.
      this.updatePlayerCamera();
      return;
    }
    const eyeH = s.stance === 1 ? EYE_CROUCH : EYE_STAND;
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const cam = this.renderer.camera;
    cam.position.set(s.x - fx * 2.3, s.y + eyeH + 0.55, s.z - fz * 2.3);
    cam.lookAt(s.x + fx * 3, s.y + eyeH * 0.9, s.z + fz * 3);
  }

  /** Fond de menu : orbite lente autour du centre de la map. */
  private updateMenuOrbit(dt: number): void {
    this.menuOrbitT += dt * 0.05;
    const cam = this.renderer.camera;
    const r = 34;
    cam.position.set(
      Math.cos(this.menuOrbitT) * r,
      13 + Math.sin(this.menuOrbitT * 0.6) * 2,
      Math.sin(this.menuOrbitT) * r,
    );
    cam.lookAt(0, 1.5, 0);
    this.renderer.setFov(this.renderer.baseFov);
    this.weaponView.setVisible(false);
  }

  // --------------------------------------------------------------------------
  // Joueurs distants + viewmodel + radar
  // --------------------------------------------------------------------------

  private updateRemotes(nowMs: number, dt: number): void {
    for (const id of this.latestRemote.keys()) {
      if (this.interpolation.sample(id, this.interpRenderT, this.tmpInterp)) {
        this.playersRenderer.update(id, this.tmpInterp, nowMs, dt);
      }
    }
    this.playersRenderer.cullStale(nowMs);
  }

  private updateViewmodel(dt: number): void {
    // En visée lunette (LR-50), l'overlay plein écran remplace le viewmodel :
    // on masque l'arme dès que la transition ADS est engagée (> 0.55).
    const scoped = this.weapons[this.slot].id === 'lr50' && this.adsT > 0.55;
    const visible = this.alive && !this.ended && !scoped;
    this.weaponView.setVisible(visible);
    if (!visible) {
      this.weaponView.decayOnly(dt); // le recul décroît même masqué
      return;
    }
    const vel = this.prediction.body.vel;
    const speed = Math.hypot(vel.x, vel.z);
    this.weaponView.update(dt, {
      adsT: this.adsT,
      speed,
      onGround: this.prediction.body.onGround,
      lookDX: this.input.lastFrameDX,
      lookDY: this.input.lastFrameDY,
    });
    // Pas locaux : une foulée tous les ~1,9 m (2,4 m en sprint).
    if (this.prediction.body.onGround && speed > 0.6) {
      this.footAcc += speed * dt;
      const stride = speed > 6 ? 2.4 : 1.9;
      if (this.footAcc >= stride) {
        this.footAcc = 0;
        this.audio.footstep(speed > 6);
      }
    } else {
      this.footAcc = 0;
    }
  }

  /** Radar : alliés toujours, ennemis seulement si UAV équipe actif. */
  private pushRadar(): void {
    const ui = useGameUI.getState();
    const serverNow = this.net ? this.net.serverNow() : Date.now();
    const uavActive = this.uavUntil > serverNow;
    const allies: { id: number; x: number; z: number; yaw: number }[] = [];
    const enemies: { id: number; x: number; z: number }[] = [];

    allies.push({
      id: this.myId,
      x: this.prediction.body.pos.x,
      z: this.prediction.body.pos.z,
      yaw: this.prediction.yaw,
    });
    for (const [id, snap] of this.latestRemote) {
      const info = this.roster.get(id);
      if (!info || snap[7] <= 0) continue;
      if (info.team === this.myTeam) {
        allies.push({ id, x: snap[1], z: snap[3], yaw: snap[4] });
      } else if (uavActive) {
        enemies.push({ id, x: snap[1], z: snap[3] });
      }
    }
    ui.engineSetMinimap({ allies, enemies, uavUntil: uavActive ? this.uavUntil : 0 });
  }

  // --------------------------------------------------------------------------
  // Helpers fx / géométrie
  // --------------------------------------------------------------------------

  private myEyePos(): Vec3 {
    return eyePos(this.prediction.body);
  }

  /** Position « poitrine » d'un joueur (moi ou un distant) pour les fx. */
  private playerChestPos(id: number): Vec3 {
    if (id === this.myId) {
      const e = this.myEyePos();
      return { x: e.x, y: e.y - 0.2, z: e.z };
    }
    const snap = this.latestRemote.get(id);
    if (snap) {
      return { x: snap[1], y: snap[2] + 1.2, z: snap[3] };
    }
    return { x: 0, y: 1.5, z: 0 };
  }

  /** Angle relatif d'un attaquant par rapport au yaw caméra (0 = devant). */
  private relYawFrom(fromId: number): number {
    const snap = this.latestRemote.get(fromId);
    if (!snap) return 0;
    const dx = snap[1] - this.prediction.body.pos.x;
    const dz = snap[3] - this.prediction.body.pos.z;
    if (dx === 0 && dz === 0) return 0;
    // Convention sim.ts : yaw = atan2(-dx, -dz).
    let rel = Math.atan2(-dx, -dz) - this.input.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    return rel;
  }

  /** Muzzle flash + tracante + son pour le tir d'un distant (via ev). */
  private remoteShotFx(shooterId: number, target: Vec3, weaponOverride?: string): void {
    const latest = this.interpolation.latest(shooterId);
    if (!latest) return;
    this.playersRenderer.flashAt(shooterId);
    // Origine : pointe du canon si l'avatar existe, sinon œil estimé.
    const eyeH = latest.stance === 1 ? EYE_CROUCH : EYE_STAND;
    if (!this.playersRenderer.muzzleWorld(shooterId, this.tmpV1)) {
      this.tmpV1.set(latest.x, latest.y + eyeH, latest.z);
    }
    this.tmpV2.set(target.x, target.y, target.z);
    this.effects.tracer(this.tmpV1, this.tmpV2);

    // Son atténué par la distance à ma caméra.
    const info = this.roster.get(shooterId);
    let weapon = weaponOverride as keyof typeof WEAPONS | undefined;
    if (!weapon || !(weapon in WEAPONS)) {
      weapon = info ? weaponForSlot(info.classId, latest.weaponSlot) : 'vsk27';
    }
    const cam = this.renderer.camera.position;
    const dist = Math.hypot(latest.x - cam.x, latest.y + eyeH - cam.y, latest.z - cam.z);
    this.audio.shot(WEAPONS[weapon] ? weapon : 'vsk27', dist);
  }

  // --------------------------------------------------------------------------
  // Réglages live
  // --------------------------------------------------------------------------

  private applySettings(): void {
    const settings = useGameUI.getState().settings;
    this.input.sensitivity = settings.sensitivity;
    this.renderer.setBaseFov(settings.fov);
    this.renderer.applyQuality(settings.quality);
    this.audio.setVolume(settings.volume / 100, settings.muted);
  }

  /** Libère tout (hors contrat — sécurité de démontage éventuel). */
  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.unsubscribeSettings();
    this.disconnect();
    this.renderer.dispose();
  }
}
