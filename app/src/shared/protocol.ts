// ============================================================================
// STRIKE 2025 — protocol.ts
// Protocole réseau client <-> serveur + constantes de configuration partagées.
// TypeScript pur : AUCUNE dépendance DOM, Node ou externe.
// Importé par le client (src/shared) et par le serveur (import relatif ../src/shared).
// Tous les messages sont des objets JSON de la forme { t: "<type>", ... }.
// ============================================================================

// ----------------------------------------------------------------------------
// Constantes de netcode
// ----------------------------------------------------------------------------

/** Fréquence de la simulation serveur (Hz). */
export const TICK_RATE = 30;
/** Durée d'un tick serveur (s). */
export const TICK_DT = 1 / TICK_RATE;
/** Fréquence d'envoi des snapshots serveur -> client (Hz). */
export const SNAP_RATE = 30;
/** Clamp du dt d'un input client (s) — anti speedhack / spikes. */
export const DT_MAX = 0.05;
/** Pas de simulation client fixe (s) — découple les inputs du framerate :
 *  60 inputs/s quel que soit le FPS (le rendu interpole entre deux pas). */
export const CLIENT_SIM_DT = 1 / 60;
/** Nombre max d'inputs traités par tick serveur pour un même joueur.
 *  À 60 inputs/s client, 2 par tick suffisent — 8 absorbe les rafales de
 *  rattrapage sans jamais jeter le reliquat (il reste en file). */
export const MAX_INPUTS_PER_TICK = 8;
/** Budget de temps simulé par joueur et par tick serveur (s) — la somme des dt
 *  consommés ne dépasse pas ce budget (anti speed-hack, rattrapage lissé). */
export const INPUT_DT_BUDGET_PER_TICK = TICK_DT * 1.6;
/** dt max accepté pour UN input à l'admission (s) — au-delà : trame rejetée. */
export const INPUT_DT_ADMIT_MAX = 0.1;

/** Délai d'interpolation des joueurs distants (ms). */
export const INTERP_DELAY_MS = 66;
/** Lag compensation : le serveur rembobine de RTT/2 + cette marge (ms). */
export const LAG_COMP_MARGIN_MS = 100;
/** Taille du ring buffer d'historique des positions par joueur (états). */
export const HISTORY_SIZE = 15;
/** Âge max d'un état d'historique réutilisable pour le rewind (ms). */
export const HISTORY_MAX_AGE_MS = 500;

/** Joueurs humains max dans la room (2 équipes de 8). */
export const MAX_PLAYERS = 16;
/** Taille d'équipe cible PAR DÉFAUT (8v8) — réglable par pack via
 *  gameMode.teamSize (1..8), les bots complètent. */
export const TEAM_TARGET_SIZE = 8;
/** Port d'écoute par défaut du serveur (process.env.PORT || DEFAULT_PORT). */
export const DEFAULT_PORT = 3000;
/** Chemin WebSocket (upgrade HTTP accepté UNIQUEMENT sur ce path). */
export const WS_PATH = '/ws';

// ----------------------------------------------------------------------------
// Constantes de gameplay
// ----------------------------------------------------------------------------

/** Points de vie max d'un joueur. */
export const HP_MAX = 100;
/** Régénération : HP/s après REGEN_DELAY_S sans dégât. */
export const REGEN_RATE = 25;
export const REGEN_DELAY_S = 4;
/** Invulnérabilité après le respawn (s). */
export const SPAWN_PROTECTION_S = 2;
/** Délai avant respawn (s) — inclut la killcam. */
export const RESPAWN_DELAY_S = 3;
/** Durée de la killcam (s) — spectate du tueur avant le respawn. */
export const KILLCAM_DURATION_S = 2.5;

/** Score d'équipe (kills) déclenchant la victoire. */
export const SCORE_TARGET = 75;
/** Durée max d'une partie (s). */
export const MATCH_DURATION_S = 600;
/** Durée de la phase de fin (podium/stats) avant retour lobby (s). */
export const END_DURATION_S = 15;

/** Multiplicateur de dégâts tête. */
export const HEADSHOT_MULTIPLIER = 2;

/** Coût du scorestreak UAV en points personnels. */
export const UAV_COST = 400;
/** Durée de l'UAV (s) : ennemis révélés sur la minimap de l'équipe. */
export const UAV_DURATION_S = 30;
/** Points personnels par kill. */
export const POINTS_KILL = 100;
/** Points personnels par assist. */
export const POINTS_ASSIST = 50;
/** Fenêtre (s) pendant laquelle un dégât non létal compte comme assist. */
export const ASSIST_WINDOW_S = 8;
/** Dégât minimal infligé pour qu'un assist soit compté. */
export const ASSIST_MIN_DAMAGE = 25;

/** Clamp du pitch (degrés). */
export const PITCH_LIMIT_DEG = 89;
/** Distance max d'un tir hitscan (m). */
export const SHOT_MAX_DIST = 300;
/** Portée d'engagement des bots (m). */
export const BOT_ENGAGE_DIST = 40;

// ----------------------------------------------------------------------------
// Identités & énumérations
// ----------------------------------------------------------------------------

/** 0 = SPECTRE (bleu), 1 = RAVAGE (orange). */
export type TeamId = 0 | 1;
export const TEAM_SPECTRE: TeamId = 0;
export const TEAM_RAVAGE: TeamId = 1;
export const TEAM_NAMES: Record<TeamId, string> = {
  0: 'SPECTRE',
  1: 'RAVAGE',
};
export const TEAM_COLORS: Record<TeamId, string> = {
  0: '#3b82f6', // bleu
  1: '#f97316', // orange
};

/** Classes prédéfinies (voir weapons.ts — CLASS_DEFS). */
export type ClassId = 'assault' | 'cqc' | 'recon' | 'breacher';

/** Identifiants d'armes (voir weapons.ts — WEAPONS). custom1-3 sont des
 *  EMPLACEMENTS d'armes créées par la communauté (armurerie) : nom, stats et
 *  modèle définis par le pack du salon, assignés aux classes via `loadouts`. */
export type WeaponId =
  | 'vsk27' | 'kv9' | 'lr50' | 'p9'
  | 'm4' | 'mp5' | 'spas12' | 'deagle'
  | 'custom1' | 'custom2' | 'custom3';

/** Slot d'arme : 0 = primaire, 1 = secondaire. */
export type WeaponSlot = 0 | 1;

/** Phases de la partie. 'lobby' n'est utilisé qu'avant le premier départ
 *  (la partie démarre dès qu'un joueur rejoint ; après 'end' on repart en
 *  'lobby' quelques secondes puis une nouvelle partie 'playing'). */
export type GamePhase = 'lobby' | 'playing' | 'end';

/** Posture du joueur dans les snapshots. */
export type Stance = 0 | 1; // 0 = debout, 1 = accroupi
export const STANCE_STAND: Stance = 0;
export const STANCE_CROUCH: Stance = 1;

/** Bitmask streakMask du snapshot : bit 0 = UAV actif pour l'équipe du joueur. */
export const STREAK_UAV = 1;

// ----------------------------------------------------------------------------
// Snapshots
// ----------------------------------------------------------------------------

/**
 * État compact d'un joueur dans un snapshot (tuple JSON pour limiter la taille).
 *   [0] id          : number   — id unique de session (>= 0)
 *   [1] x, [2] y, [3] z : number — position des PIEDS (m), arrondie à 0.01
 *   [4] yaw         : number   — radians, arrondi à 0.001
 *   [5] pitch       : number   — radians, arrondi à 0.001
 *   [6] stance      : Stance
 *   [7] hp          : number   — 0..100 (0 = mort, en attente de respawn)
 *   [8] weaponSlot  : WeaponSlot — arme actuellement en main
 *   [9] streakMask  : number   — bit0: UAV actif pour SON équipe
 *   [10] ack        : number   — dernier seq d'input intégré par le serveur
 *                                (-1 si aucun ; bots : -1). Réconciliation
 *                                EXACTE côté client : purge pending <= ack,
 *                                replay du reste — plus d'heuristique RTT.
 */
export type PlayerSnapshot = [
  id: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  stance: Stance,
  hp: number,
  weaponSlot: WeaponSlot,
  streakMask: number,
  ack: number,
];

/** Infos statiques d'un joueur (envoyées dans welcome / ev join). */
export interface PlayerInfo {
  id: number;
  name: string;
  team: TeamId;
  classId: ClassId;
  bot: boolean;
}

/** Scores d'équipe : [SPECTRE, RAVAGE]. */
export type TeamScores = [number, number];

/**
 * Objet placé via l'éditeur de map (mode build). x/z = centre, y = base
 * (pieds), rot = quarts de tour (0-3) — les collisions étant en AABB, seules
 * les rotations de 90° sont permises. `kind` référence MAP_OBJECT_DEFS
 * (shared/mapObjects.ts). Persisté côté serveur (data/map-objects.json),
 * envoyé dans welcome et rediffusé à chaque sauvegarde de l'éditeur.
 */
export interface PlacedObject {
  id: number;
  kind: string;
  x: number;
  y: number;
  z: number;
  rot: 0 | 1 | 2 | 3;
  /** Échelle par axe en espace objet (défaut 1 ; clampée 0.25–5 côté serveur). */
  sx?: number;
  sy?: number;
  sz?: number;
}

/**
 * Édition d'une boîte de la MAP DE BASE (MAP_BOXES) par l'éditeur :
 * `idx` = index dans MAP_BOXES d'origine (garanti par MAP_VERSION — les
 * éditions sont invalidées si la map de base change de version).
 * `remove` = suppression ; sinon `box` = nouvel AABB
 * [minX, minY, minZ, maxX, maxY, maxZ] (déplacement / redimensionnement).
 */
export interface MapBaseEdit {
  idx: number;
  remove?: boolean;
  box?: [number, number, number, number, number, number];
}

/**
 * Surcharge des STATS d'une arme (armurerie — bornées côté serveur, voir
 * shared/weaponMods.ts). Tous les champs sont optionnels : absent = valeur
 * du game design d'origine.
 */
export interface WeaponStatsMod {
  /** Nom affiché (HUD/killfeed) — surtout pour les armes custom1-3. */
  name?: string;
  auto?: boolean;
  damage?: number;
  rpm?: number;
  magSize?: number;
  reserveAmmo?: number;
  reloadMs?: number;
  adsMs?: number;
  adsFovMult?: number;
  recoilV?: number;
  recoilH?: number;
  spreadHip?: number;
  spreadAds?: number;
  mobility?: number;
  drawMs?: number;
}

/** Modèle 3D custom d'une arme (cosmétique — uploadé via /mods/models) avec
 *  sa calibration (les GLB arrivent dans tous les axes/échelles). */
export interface WeaponModelMod {
  /** Chemin serveur du modèle : /mods/models/<hash>.<ext> UNIQUEMENT.
   *  ABSENT = calibration LIBRE du modèle d'ORIGINE de l'arme. */
  file?: string;
  /** Rotation Y (rad) amenant le canon sur -Z. */
  rotY: number;
  /** Rotation X libre (rad) — tangage (canon qui pique/monte). */
  rotX?: number;
  /** Rotation Z libre (rad) — roulis (arme penchée). */
  rotZ?: number;
  /** Longueur réelle cible (m). */
  realLength: number;
  /** Hauteur de la ligne de visée au-dessus du centre (m). */
  adsY: number;
  /** Hauteur de la bouche du canon au-dessus du centre (m). */
  muzzleY: number;
  /** Décalages de position du modèle (m, après normalisation) : droite/haut/
   *  avant (-Z = vers l'avant, donc offZ négatif avance l'arme). */
  offX?: number;
  offY?: number;
  offZ?: number;
  /** Texture couleur (albedo) : /mods/textures/<hash>.<ext> — remplace les
   *  matériaux du modèle (indispensable pour FBX/OBJ/STL sans textures). */
  map?: string;
  /** Texture normale (relief), optionnelle. */
  normalMap?: string;
}

// ----------------------------------------------------------------------------
// Modes de jeu (définis par le pack — les créateurs de maps décident)
// ----------------------------------------------------------------------------

/** Type de mode : match à mort / domination (capture de zones) /
 *  recherche & destruction (bombe, rounds sans respawn). */
export type GameModeType = 'tdm' | 'dom' | 'sad';

/** Configuration du mode de jeu d'un pack. Tous les réglages sont BORNÉS
 *  côté serveur (sanitizeGameMode). Les zones jouables (points de capture,
 *  sites de bombe) sont des PlacedObject de kind 'zone:capture' /
 *  'zone:bombsite' placés dans l'éditeur. Absent = TDM classique. */
export interface GameModeConfig {
  type: GameModeType;
  /** tdm : kills cibles · dom : points cibles. */
  scoreTarget?: number;
  /** tdm/dom : durée du match (s). */
  matchDurationS?: number;
  /** dom : secondes de présence pour retourner une zone. */
  captureTimeS?: number;
  /** dom : points gagnés par seconde et par zone tenue. */
  pointsPerSecond?: number;
  /** sad : durée d'un round (s) — expirée sans pose = victoire défense. */
  roundTimeS?: number;
  /** sad : temps de POSE de la bombe (s, E maintenu dans un site). */
  plantTimeS?: number;
  /** sad : temps de DÉSAMORÇAGE (s, E maintenu près de la bombe). */
  defuseTimeS?: number;
  /** sad : compte à rebours de la bombe posée (s). */
  bombTimeS?: number;
  /** sad : rounds gagnés pour remporter le match. */
  roundsToWin?: number;
  /** TOUS modes : taille des équipes (1..8) — les bots complètent. */
  teamSize?: number;
}

/** État d'une zone de capture (domination). */
export interface ZoneState {
  /** Propriétaire : -1 = neutre, sinon équipe. */
  owner: -1 | TeamId;
  /** Progression de capture 0..1 (au profit de `capturing`). */
  progress: number;
  /** Équipe en train de capturer (-1 = personne / contesté). */
  capturing: -1 | TeamId;
}

/** Phase d'un round R&D. */
export type SadRoundPhase = 'live' | 'planted' | 'over';

/** État périodique du mode (≈4 Hz + à chaque événement). */
export interface ModeStateMsg {
  t: 'mode';
  // ---- domination ----
  zones?: ZoneState[];
  // ---- recherche & destruction ----
  round?: number;
  attackers?: TeamId;
  roundPhase?: SadRoundPhase;
  /** Timestamp serveur (ms) de l'échéance courante (fin de round OU bombe). */
  roundEndsAt?: number;
  /** Index du site où la bombe est posée (-1 sinon). */
  bombSite?: number;
  /** Action E en cours (pose/désamorçage) — pour les barres de progression. */
  action?: { playerId: number; kind: 'plant' | 'defuse'; progress: number } | null;
}

/** Événement de mode : annonce FR prête à afficher (bandeau HUD). */
export interface EvMode {
  kind: 'mode';
  msg: string;
  /** Sous-type pour le style/son côté client. */
  sub: 'plant' | 'defuse' | 'boom' | 'roundWin' | 'zone' | 'info';
  team?: TeamId;
}

/** Mods d'armes d'un salon : par arme, stats et/ou modèle custom. */
export type WeaponModsConfig = Partial<
  Record<WeaponId, { stats?: WeaponStatsMod; model?: WeaponModelMod }>
>;

/** Loadouts remappés par classe : [primaire, secondaire]. Absent = loadout
 *  d'origine. Permet d'assigner les armes custom1-3 aux classes. */
export type ClassLoadouts = Partial<Record<ClassId, [WeaponId, WeaponId]>>;

/**
 * OBJET DE MAP custom (prop) défini par le pack : modèle 3D uploadé
 * (+ textures), calibré par rotation et HAUTEUR réelle. Les dimensions de
 * collision (sizeX/Y/Z) sont calculées dans l'éditeur depuis la bbox du
 * modèle à cette hauteur, et STOCKÉES (le serveur ne charge jamais de 3D).
 * Un PlacedObject y réfère via kind = 'prop:<id>'.
 */
export interface CustomPropDef {
  /** Id local au pack (p1, p2, …). */
  id: string;
  /** Nom affiché dans la palette. */
  label: string;
  /** Chemin serveur du modèle : /mods/models/<hash>.<ext>. */
  file: string;
  /** Texture couleur optionnelle : /mods/textures/<hash>.<ext>. */
  map?: string;
  /** Texture normale optionnelle. */
  normalMap?: string;
  /** Rotation Y (rad) — orientation « de face » de l'objet. */
  rotY: number;
  /** Hauteur réelle cible (m) — l'échelle en découle. */
  height: number;
  /** Dimensions de la boîte de collision (m), dérivées du modèle calibré. */
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

/** Terrain de départ d'un pack : map de base ou terrain vide (sol plat +
 *  murs d'enceinte uniquement). */
export type BaseTerrain = 'kestrel' | 'flat';

/** Diffusion de l'état d'édition de map (à la sauvegarde — met à jour visuel
 *  ET collisions chez tous les clients connectés). */
export interface MapObjectsMsg {
  t: 'mapObjects';
  objects: PlacedObject[];
  baseEdits?: MapBaseEdit[];
  weaponMods?: WeaponModsConfig;
  loadouts?: ClassLoadouts;
  /** Objets de map custom du pack (props importés). */
  props?: CustomPropDef[];
  /** Terrain de départ ('kestrel' par défaut). */
  baseTerrain?: BaseTerrain;
  /** Mode de jeu du pack (absent = TDM classique). */
  gameMode?: GameModeConfig;
  /** Taille de la map en % (50..200, footprint XZ). Absent = 100. */
  mapScale?: number;
}

/** Métadonnées de map envoyées dans welcome (le client possède déjà les
 *  données complètes via src/shared/map.ts ; on n'envoie que l'essentiel). */
export interface MapMeta {
  name: string; // 'KESTREL YARD' (MAP_NAME de map.ts)
  version: number; // doit correspondre à MAP_VERSION de map.ts
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Configuration de partie envoyée dans welcome. */
export interface GameConfig {
  tickRate: number; // TICK_RATE
  snapRate: number; // SNAP_RATE
  scoreTarget: number; // SCORE_TARGET
  matchDurationS: number; // MATCH_DURATION_S
  uavCost: number; // UAV_COST
  uavDurationS: number; // UAV_DURATION_S
  hpMax: number; // HP_MAX
  respawnDelayS: number; // RESPAWN_DELAY_S
  spawnProtectionS: number; // SPAWN_PROTECTION_S
  interpDelayMs: number; // INTERP_DELAY_MS
}

/** Stats de fin de partie d'un joueur (phase 'end'). */
export interface PlayerFinalStats {
  id: number;
  name: string;
  team: TeamId;
  kills: number;
  deaths: number;
  assists: number;
  score: number; // points personnels cumulés
}

// ----------------------------------------------------------------------------
// Messages CLIENT -> SERVEUR
// ----------------------------------------------------------------------------

/** Première trame envoyée après l'ouverture du socket. */
export interface HelloMsg {
  t: 'hello';
  name: string; // 1..16 caractères (sanitizé serveur)
  classId: ClassId;
}

/**
 * Données d'un input de simulation. `seq` est strictement croissant ; `dt` est
 * le pas de simulation client (CLIENT_SIM_DT en régime normal, clampé serveur
 * à DT_MAX). `keys` est le bitmask de sim.ts (KEY_FORWARD | KEY_BACK | ...).
 * yaw/pitch en radians.
 */
export interface InputData {
  seq: number;
  dt: number;
  yaw: number;
  pitch: number;
  keys: number;
}

/** Input unitaire (conservé pour compatibilité — préférer InputBatchMsg). */
export interface InputMsg extends InputData {
  t: 'input';
}

/** Lot d'inputs d'une fenêtre de flush (~33 ms) : UN message réseau au lieu
 *  d'un par input — divise le framing/parse par ~2-6 selon le FPS. */
export interface InputBatchMsg {
  t: 'inputs';
  list: InputData[];
}

/**
 * Demande de tir hitscan. Le serveur valide cadence/munitions et rembobine
 * les positions adverses. ox/oy/oz = origine (œil), dx/dy/dz = direction
 * normalisée (après dispersion calculée côté client — le serveur ne fait pas
 * confiance à la dispersion mais re-valide l'origine à ±1 m du corps simulé).
 */
export interface ShootMsg {
  t: 'shoot';
  seq: number; // séquence de tirs (anti-rejeu)
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  weapon: WeaponId;
  ads: boolean;
  /** Nombre de plombs (fusil à pompe uniquement) : 1 par défaut. Le serveur
   *  consomme UNE cartouche par tir et évalue `pellets` rayons en cône. */
  pellets?: number;
}

export interface ReloadMsg {
  t: 'reload';
}

/** Changement d'arme (0 = primaire, 1 = secondaire). */
export interface SwitchMsg {
  t: 'switch';
  slot: WeaponSlot;
}

/** Activation du scorestreak UAV (touche « 4 »). */
export interface StreakMsg {
  t: 'streak';
}

/** Mesure de latence : le client envoie c = performance.now() (ms). */
export interface PingMsg {
  t: 'ping';
  c: number;
}

/** Changement de classe en cours de partie (appliqué au prochain respawn). */
export interface SetClassMsg {
  t: 'setClass';
  classId: ClassId;
}

export type ClientMsg =
  | HelloMsg
  | InputMsg
  | InputBatchMsg
  | ShootMsg
  | ReloadMsg
  | SwitchMsg
  | StreakMsg
  | SetClassMsg
  | PingMsg;

// ----------------------------------------------------------------------------
// Messages SERVEUR -> CLIENT
// ----------------------------------------------------------------------------

/** Réponse à `hello`. `players` inclut les bots. `endsAt` = timestamp
 *  serveur (ms, epoch) de fin de partie ; 0 si phase != 'playing'. */
export interface WelcomeMsg {
  t: 'welcome';
  id: number; // id attribué au joueur
  tick: number; // tick serveur courant
  config: GameConfig;
  mapMeta: MapMeta;
  players: PlayerInfo[];
  teams: { team: TeamId; playerIds: number[] }[];
  scores: TeamScores;
  phase: GamePhase;
  endsAt: number;
  /** Objets placés via l'éditeur de map (visuel + collisions). */
  mapObjects?: PlacedObject[];
  /** Éditions des boîtes de la map de base (déplacements/suppressions). */
  baseEdits?: MapBaseEdit[];
  /** Mods d'armes du salon (stats bornées + modèles 3D custom). */
  weaponMods?: WeaponModsConfig;
  /** Loadouts remappés par classe (armes custom assignées). */
  loadouts?: ClassLoadouts;
  /** Objets de map custom du pack (props importés). */
  props?: CustomPropDef[];
  /** Terrain de départ ('kestrel' par défaut). */
  baseTerrain?: BaseTerrain;
  /** Mode de jeu du salon (absent = TDM classique). */
  gameMode?: GameModeConfig;
  /** Taille de la map en % (50..200). Absent = 100. */
  mapScale?: number;
}

/** Snapshot complet à SNAP_RATE Hz. */
export interface SnapMsg {
  t: 'snap';
  tick: number;
  pl: PlayerSnapshot[];
}

// ---- Événements (ev) -------------------------------------------------------

/** Touché confirmé : envoyé au TIREUR (hitmarker) — hp = PV restants de la cible. */
export interface EvHit {
  kind: 'hit';
  targetId: number;
  damage: number;
  hp: number;
  head: boolean;
}

/** Dégât subi : envoyé à la VICTIME (direction/indicateur de dégâts). */
export interface EvDamage {
  kind: 'damage';
  fromId: number;
  damage: number;
  hp: number; // PV restants de la victime
  head: boolean;
}

/** Kill : broadcast à tous. `streakPoints` = total de points du tueur après
 *  le kill (pour l'UI streak). victimId peut être tué par le monde ? Non :
 *  killerId >= 0 toujours (pas de dégâts environnementaux). */
export interface EvKill {
  kind: 'kill';
  killerId: number;
  victimId: number;
  weapon: WeaponId;
  head: boolean;
  assistIds: number[]; // joueurs crédités d'un assist (peut être vide)
  scores: TeamScores; // scores d'équipe après le kill
}

/** Respawn d'un joueur : broadcast (le concerné place sa caméra). */
export interface EvRespawn {
  kind: 'respawn';
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  protectUntil: number; // timestamp serveur (ms) de fin de protection
}

/** Mise à jour des scores d'équipe (envoyé aussi via EvKill ; kind dédié
 *  pour les cas hors kill — ex. correction). */
export interface EvScore {
  kind: 'score';
  scores: TeamScores;
}

/** UAV activé : broadcast à l'équipe bénéficiaire. */
export interface EvStreak {
  kind: 'streak';
  id: number; // joueur ayant activé
  team: TeamId;
  until: number; // timestamp serveur (ms) de fin d'UAV
}

/** Changement de phase. En phase 'end', `stats` et `winner` sont fournis ;
 *  la partie suivante redémarre après END_DURATION_S. */
export interface EvPhase {
  kind: 'phase';
  phase: GamePhase;
  endsAt: number; // timestamp serveur (ms) ; pour 'end' = fin du podium
  winner: TeamId | -1; // -1 = égalité (uniquement en phase 'end')
  stats: PlayerFinalStats[]; // vide hors phase 'end'
}

export interface EvJoin {
  kind: 'join';
  player: PlayerInfo;
}

export interface EvLeave {
  kind: 'leave';
  id: number;
}

/** Refus d'action (reload impossible, streak sans points, etc.) — optionnel,
 *  utilisé pour le feedback UI (ex. « munitions pleines »). Pour un refus de
 *  reload, `mag`/`reserve` portent l'état AUTORITAIRE de l'arme en main afin
 *  que le miroir client se resynchronise (désync possible après un tir mangé). */
export interface EvReject {
  kind: 'reject';
  what: 'reload' | 'switch' | 'streak' | 'shoot';
  reason: string;
  mag?: number;
  reserve?: number;
}

export type GameEvent =
  | EvHit
  | EvDamage
  | EvKill
  | EvRespawn
  | EvScore
  | EvStreak
  | EvPhase
  | EvJoin
  | EvLeave
  | EvReject
  | EvMode;

/** Enveloppe événement : { t: 'ev', ...GameEvent }. */
export type EvMsg = { t: 'ev' } & GameEvent;

/** Réponse à `ping` : c = valeur renvoyée, s = timestamp serveur (ms). */
export interface PongMsg {
  t: 'pong';
  c: number;
  s: number;
}

export type ServerMsg = WelcomeMsg | SnapMsg | EvMsg | PongMsg | MapObjectsMsg | ModeStateMsg;

// ----------------------------------------------------------------------------
// Helpers d'encodage / décodage
// ----------------------------------------------------------------------------

/** Sérialise un message (JSON compact). */
export function encodeMsg(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

/**
 * Parse un message entrant. Retourne null si le JSON est invalide ou si le
 * champ discriminant `t` est absent/non string. NE valide PAS la sémantique
 * (le destinataire doit valider les champs, ex. Number.isFinite).
 */
export function decodeMsg<T = ClientMsg | ServerMsg>(data: string): T | null {
  try {
    const obj = JSON.parse(data);
    if (obj === null || typeof obj !== 'object' || typeof obj.t !== 'string') {
      return null;
    }
    return obj as T;
  } catch {
    return null;
  }
}

/** Arrondis utilisés avant sérialisation des snapshots (réduction taille). */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Construit la config de référence (envoyée dans welcome). */
export function buildGameConfig(): GameConfig {
  return {
    tickRate: TICK_RATE,
    snapRate: SNAP_RATE,
    scoreTarget: SCORE_TARGET,
    matchDurationS: MATCH_DURATION_S,
    uavCost: UAV_COST,
    uavDurationS: UAV_DURATION_S,
    hpMax: HP_MAX,
    respawnDelayS: RESPAWN_DELAY_S,
    spawnProtectionS: SPAWN_PROTECTION_S,
    interpDelayMs: INTERP_DELAY_MS,
  };
}

// ----------------------------------------------------------------------------
// Hypothèses
// ----------------------------------------------------------------------------
// 1. Snapshots JSON complets (pas de delta) : <= 12 joueurs -> ~1,2 Ko/snap,
//    acceptable à SNAP_RATE=30 Hz (~36 Ko/s/joueur max, ~16-27 Ko/s typique).
// 2. Les timestamps `endsAt` / `until` / `protectUntil` sont des ms epoch du
//    SERVEUR ; le client estime l'offset serveur via ping/pong (s - c).
// 3. EvKill transporte aussi les scores -> l'UI n'a pas besoin d'attendre un
//    snapshot pour mettre à jour le tableau des scores.
// 4. Pas de message 'hit' client->serveur : les hitmarkers sont 100 % confirmés
//    par le serveur (anti-triche), jamais décidés côté client.
// 5. Le champ `seq` de ShootMsg est indépendant du seq d'InputMsg : il permet
//    au serveur d'ignorer les tirs dupliqués/rejoués.
