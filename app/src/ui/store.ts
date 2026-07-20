// ============================================================================
// STRIKE 2025 — store.ts
// Store Zustand `useGameUI` — contrat EXACT de design/bridge.md §2.
// Le moteur (src/game/) ÉCRIT via les actions `engine*` ; l'UI LIT et appelle
// uniquement setPseudo / setClassId / goToLoadout / backToMenu (+ GameClient).
// Les paramètres (sensibilité, FOV, volume, qualité, muet) sont persistés en
// localStorage et appliqués immédiatement.
// ============================================================================

import { create } from 'zustand';
import type {
  TeamId,
  ClassId,
  WeaponId,
  WeaponSlot,
  PlayerFinalStats,
  PlayerInfo,
  TeamScores,
} from '../shared/protocol';

// ----------------------------------------------------------------------------
// Types partagés du bridge (bridge.md §1) — référence, ne pas dévier.
// ----------------------------------------------------------------------------

/** Phases d'interface (distinctes de protocol.GamePhase). */
export type UIPhase =
  | 'menu'       // écran d'accueil (pseudo)
  | 'loadout'    // choix de la classe
  | 'connecting' // connexion WebSocket en cours
  | 'playing'    // en vie, HUD actif
  | 'dead'       // mort : killcam puis attente respawn
  | 'end'        // podium / stats de fin
  | 'editor'     // mode BUILD : éditeur de map (hors match)
  | 'community'  // salons & maps de la communauté
  | 'admin';     // panel d'administration (code requis)

export interface KillfeedEntry {
  id: number;          // compteur local croissant (pour les clés React)
  killerName: string;
  victimName: string;
  killerTeam: TeamId;
  victimTeam: TeamId;
  weapon: WeaponId;
  head: boolean;
  at: number;          // Date.now() local (expiration après 5 s)
}

export interface HitmarkerEvent {
  id: number;          // compteur local croissant
  kind: 'hit' | 'kill';
  head: boolean;
  at: number;          // Date.now() local (affichage ~150 ms)
}

/** Indicateur directionnel de dégât subi (arc rouge à l'écran). */
export interface DamageIndicator {
  id: number;
  /** Angle relatif par rapport au yaw de la caméra (radians, 0 = devant). */
  relYaw: number;
  at: number;
}

/** Données de minimap, rafraîchies à chaque snapshot reçu. */
export interface MinimapData {
  /** Joueurs alliés vivants : position + yaw (flèche). */
  allies: { id: number; x: number; z: number; yaw: number }[];
  /** Ennemis VISIBLES : rempli UNIQUEMENT si l'UAV d'équipe est actif
   *  (streakMask bit0 du snapshot local) — jamais autrement. */
  enemies: { id: number; x: number; z: number }[];
  /** UAV actif pour mon équipe jusqu'à ce timestamp serveur (0 = inactif). */
  uavUntil: number;
}

export interface KillcamInfo {
  killerId: number;
  killerName: string;
  weapon: WeaponId;
  /** Timestamp local (Date.now()) de fin de killcam -> respawn. */
  until: number;
}

/** Ligne du tableau des scores (Tab), dérivée des ev kill/join/leave. */
export interface BoardEntry {
  id: number;
  name: string;
  team: TeamId;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  bot: boolean;
}

export interface Announcement {
  id: number;
  text: string;        // déjà en français, prêt à afficher
  kind: 'info' | 'streak' | 'phase';
  at: number;
}

export interface FinalResults {
  winner: TeamId | -1; // -1 = égalité
  scores: TeamScores;
  stats: PlayerFinalStats[];
  /** Timestamp local de retour au menu (phase end + END_DURATION_S). */
  returnAt: number;
}

// ----------------------------------------------------------------------------
// Paramètres persistés (menu.md E) — extension UI du store, hors contrat moteur
// ----------------------------------------------------------------------------

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface GameSettings {
  /** Sensibilité souris 0.1..10.0 (défaut 2.5). */
  sensitivity: number;
  /** Champ de vision horizontal 70..110 (défaut 90). */
  fov: number;
  /** Volume principal 0..100 (défaut 80). */
  volume: number;
  /** Qualité graphique (défaut 'high' = ÉLEVÉ). */
  quality: QualityLevel;
  /** Son coupé (toggle menu, persisté). */
  muted: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 2.5,
  fov: 90,
  volume: 80,
  quality: 'high',
  muted: false,
};

const SETTINGS_KEY = 'strike2025.settings';
const PSEUDO_KEY = 'strike2025.pseudo';

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const qualities: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
    return {
      sensitivity: clampNum(parsed.sensitivity, 0.1, 10, DEFAULT_SETTINGS.sensitivity),
      fov: clampNum(parsed.fov, 70, 110, DEFAULT_SETTINGS.fov),
      volume: clampNum(parsed.volume, 0, 100, DEFAULT_SETTINGS.volume),
      quality: qualities.includes(parsed.quality as QualityLevel)
        ? (parsed.quality as QualityLevel)
        : DEFAULT_SETTINGS.quality,
      muted: parsed.muted === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* stockage indisponible : silencieux */
  }
}

function loadPseudo(): string {
  try {
    return localStorage.getItem(PSEUDO_KEY) ?? '';
  } catch {
    return '';
  }
}

// ----------------------------------------------------------------------------
// État + actions (bridge.md §2) — chaque action = un set() simple.
// ----------------------------------------------------------------------------

export interface GameUIState {
  // ---- Flux de navigation ----
  phase: UIPhase;
  pseudo: string;            // saisi au menu (1..16 caractères)
  classId: ClassId;          // classe choisie ('assault' | 'cqc' | 'recon')
  /** Salon sélectionné (multi-room) — null : salon principal. */
  selectedRoom: { id: string; name: string; mapName: string } | null;

  // ---- Connexion ----
  connected: boolean;
  connectionError: string | null; // message FR affiché au menu
  pingMs: number;

  // ---- Identité partie ----
  myId: number;              // -1 avant welcome
  myTeam: TeamId | null;
  players: PlayerInfo[];     // roster complet (welcome + join/leave)
  board: Record<number, BoardEntry>; // tableau des scores dérivé des ev

  // ---- État de combat (joueur local) ----
  hp: number;                // 0..100 (depuis snapshots / ev damage)
  ammoMag: number;
  ammoReserve: number;
  weaponSlot: WeaponSlot;
  reloading: boolean;
  reloadEndsAt: number;      // timestamp local (progress bar), 0 si inactif
  ads: boolean;              // visée en cours (pour réticule/FOV UI)

  // ---- Scorestreak ----
  streakPoints: number;      // points personnels vers l'UAV (0..400+)
  uavActiveUntil: number;    // timestamp serveur, 0 = inactif

  // ---- Partie ----
  scores: TeamScores;
  matchEndsAt: number;       // timestamp serveur (0 = pas de timer actif)
  serverOffsetMs: number;    // offset estimé serveur - local (ping/pong)

  // ---- Données dynamiques ----
  minimap: MinimapData;
  killfeed: KillfeedEntry[];       // max 6, purge > 5 s côté composant
  hitmarkers: HitmarkerEvent[];    // transitoires (~150 ms)
  damageIndicators: DamageIndicator[];
  announcements: Announcement[];   // max 3, purge > 4 s
  killcam: KillcamInfo | null;     // non null pendant 'dead'
  results: FinalResults | null;    // non null pendant 'end'

  // ---- Paramètres persistés (extension UI) ----
  settings: GameSettings;

  // ---- Actions : NAVIGATION (appelées par l'UI) ----
  setPseudo(pseudo: string): void;
  setClassId(classId: ClassId): void;
  setSelectedRoom(room: { id: string; name: string; mapName: string } | null): void;
  goToLoadout(): void;             // menu -> loadout (valide le pseudo)
  backToMenu(): void;

  // ---- Actions : PARAMÈTRES (appelées par l'UI) ----
  setSettings(patch: Partial<GameSettings>): void;
  resetSettings(): void;

  // ---- Actions : ÉCRITURES MOTEUR (appelées par GameClient UNIQUEMENT) ----
  engineSetPhase(phase: UIPhase): void;
  engineSetConnected(connected: boolean, error?: string): void;
  engineSetWelcome(myId: number, myTeam: TeamId, players: PlayerInfo[],
                   scores: TeamScores, matchEndsAt: number): void;
  engineSetVitals(hp: number): void;
  engineSetAmmo(mag: number, reserve: number, slot: WeaponSlot,
                reloading: boolean, reloadEndsAt: number): void;
  engineSetAds(ads: boolean): void;
  engineSetStreak(points: number, uavUntil: number): void;
  engineSetScores(scores: TeamScores): void;
  engineSetMatchEndsAt(endsAt: number): void;
  engineSetServerOffset(offsetMs: number): void;
  engineSetPing(pingMs: number): void;
  engineSetMinimap(data: MinimapData): void;
  engineAddKillfeed(entry: Omit<KillfeedEntry, 'id' | 'at'>): void;
  engineAddHitmarker(kind: 'hit' | 'kill', head: boolean): void;
  engineAddDamageIndicator(relYaw: number): void;
  engineAddAnnouncement(text: string, kind: Announcement['kind']): void;
  engineSetKillcam(info: KillcamInfo | null): void;
  engineSetResults(results: FinalResults | null): void;
  engineUpsertBoard(id: number, patch: Partial<BoardEntry>): void;
  engineRemoveFromBoard(id: number): void;
  engineResetMatchState(): void;   // remet à zéro hp/killfeed/results… (nouvelle partie)
}

// Compteurs locaux d'id (bridge.md §2) — variables de module incrémentées.
let killfeedId = 0;
let hitmarkerId = 0;
let damageIndicatorId = 0;
let announcementId = 0;

/** Entrée de board vierge pour un joueur du roster. */
function freshBoardEntry(p: PlayerInfo): BoardEntry {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    kills: 0,
    deaths: 0,
    assists: 0,
    score: 0,
    bot: p.bot,
  };
}

export const useGameUI = create<GameUIState>((set) => ({
  // ---- État initial ----
  phase: 'menu',
  pseudo: loadPseudo(),
  classId: 'assault',
  selectedRoom: null,

  connected: false,
  connectionError: null,
  pingMs: 0,

  myId: -1,
  myTeam: null,
  players: [],
  board: {},

  hp: 100,
  ammoMag: 0,
  ammoReserve: 0,
  weaponSlot: 0,
  reloading: false,
  reloadEndsAt: 0,
  ads: false,

  streakPoints: 0,
  uavActiveUntil: 0,

  scores: [0, 0],
  matchEndsAt: 0,
  serverOffsetMs: 0,

  minimap: { allies: [], enemies: [], uavUntil: 0 },
  killfeed: [],
  hitmarkers: [],
  damageIndicators: [],
  announcements: [],
  killcam: null,
  results: null,

  settings: loadSettings(),

  // ---- Navigation (UI) ----
  setPseudo: (pseudo) => {
    try {
      localStorage.setItem(PSEUDO_KEY, pseudo);
    } catch {
      /* silencieux */
    }
    set({ pseudo });
  },
  setClassId: (classId) => set({ classId }),
  setSelectedRoom: (room) => set({ selectedRoom: room }),
  goToLoadout: () => set({ phase: 'loadout', connectionError: null }),
  backToMenu: () => set({ phase: 'menu' }),

  // ---- Paramètres (UI) ----
  setSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch };
      saveSettings(settings);
      return { settings };
    }),
  resetSettings: () => {
    const settings = { ...DEFAULT_SETTINGS };
    saveSettings(settings);
    set({ settings });
  },

  // ---- Écritures moteur ----
  engineSetPhase: (phase) => set({ phase }),
  engineSetConnected: (connected, error) =>
    set({ connected, connectionError: error ?? null }),
  engineSetWelcome: (myId, myTeam, players, scores, matchEndsAt) =>
    set({
      myId,
      myTeam,
      players,
      scores,
      matchEndsAt,
      // init board (bridge.md §3, correspondance welcome)
      board: Object.fromEntries(players.map((p) => [p.id, freshBoardEntry(p)])),
    }),
  engineSetVitals: (hp) => set({ hp }),
  engineSetAmmo: (mag, reserve, slot, reloading, reloadEndsAt) =>
    set({ ammoMag: mag, ammoReserve: reserve, weaponSlot: slot, reloading, reloadEndsAt }),
  engineSetAds: (ads) => set({ ads }),
  engineSetStreak: (points, uavUntil) =>
    set({ streakPoints: points, uavActiveUntil: uavUntil }),
  engineSetScores: (scores) => set({ scores }),
  engineSetMatchEndsAt: (endsAt) => set({ matchEndsAt: endsAt }),
  engineSetServerOffset: (offsetMs) => set({ serverOffsetMs: offsetMs }),
  engineSetPing: (pingMs) => set({ pingMs }),
  engineSetMinimap: (data) => set({ minimap: data }),
  engineAddKillfeed: (entry) =>
    set((state) => ({
      killfeed: [...state.killfeed, { ...entry, id: ++killfeedId, at: Date.now() }].slice(-6),
    })),
  engineAddHitmarker: (kind, head) =>
    set((state) => ({
      hitmarkers: [...state.hitmarkers, { id: ++hitmarkerId, kind, head, at: Date.now() }],
    })),
  engineAddDamageIndicator: (relYaw) =>
    set((state) => ({
      damageIndicators: [
        ...state.damageIndicators,
        { id: ++damageIndicatorId, relYaw, at: Date.now() },
      ],
    })),
  engineAddAnnouncement: (text, kind) =>
    set((state) => ({
      announcements: [
        ...state.announcements,
        { id: ++announcementId, text, kind, at: Date.now() },
      ].slice(-3),
    })),
  engineSetKillcam: (info) => set({ killcam: info }),
  engineSetResults: (results) => set({ results }),
  engineUpsertBoard: (id, patch) =>
    set((state) => {
      const base: BoardEntry = state.board[id] ?? {
        id,
        name: '',
        team: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        score: 0,
        bot: false,
      };
      return { board: { ...state.board, [id]: { ...base, ...patch, id } } };
    }),
  engineRemoveFromBoard: (id) =>
    set((state) => {
      const board = { ...state.board };
      delete board[id];
      return { board };
    }),
  engineResetMatchState: () =>
    set((state) => ({
      hp: 100,
      ammoMag: 0,
      ammoReserve: 0,
      weaponSlot: 0,
      reloading: false,
      reloadEndsAt: 0,
      ads: false,
      streakPoints: 0,
      uavActiveUntil: 0,
      scores: [0, 0],
      matchEndsAt: 0,
      minimap: { allies: [], enemies: [], uavUntil: 0 },
      killfeed: [],
      hitmarkers: [],
      damageIndicators: [],
      announcements: [],
      killcam: null,
      results: null,
      // Nouvelle partie : stats remises à zéro en conservant le roster ACTUEL
      // du board (state.players n'est renseigné qu'au welcome et ne suit pas
      // les join/leave de bots — il serait périmé).
      board: Object.fromEntries(
        Object.values(state.board).map((e) => [
          e.id,
          { ...e, kills: 0, deaths: 0, assists: 0, score: 0 },
        ]),
      ),
    })),
}));
