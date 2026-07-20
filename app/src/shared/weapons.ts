// ============================================================================
// STRIKE 2025 — weapons.ts
// Données des armes et des classes. TypeScript pur, zéro dépendance externe.
// Toutes les armes sont HITSCAN : le serveur raycaste (sim.ts) au moment du
// tir validé, avec rembobinage (lag compensation).
// ============================================================================

import type { ClassId, WeaponId, WeaponSlot } from './protocol';
import { HEADSHOT_MULTIPLIER } from './protocol';

// ----------------------------------------------------------------------------
// Spécification d'une arme
// ----------------------------------------------------------------------------

export interface FalloffSpec {
  /** Distance (m) à partir de laquelle les dégâts chutent. */
  start: number;
  /** Distance (m) où la chute atteint son minimum. */
  end: number;
  /** Multiplicateur minimal des dégâts à `end` et au-delà. */
  minMult: number;
}

export interface RecoilSpec {
  /** Kick vertical par balle (degrés, ajouté au pitch). */
  vertical: number;
  /** Amplitude aléatoire horizontale par balle (degrés, ±). */
  horizontal: number;
}

export interface SpreadSpec {
  /** Dispersion au hip-fire (degrés, cône plein). */
  hip: number;
  /** Dispersion en ADS (degrés, cône plein). */
  ads: number;
}

export interface WeaponSpec {
  id: WeaponId;
  /** Nom affiché en français. */
  name: string;
  /** Slot natif : 0 = primaire, 1 = secondaire. */
  slot: WeaponSlot;
  /** Tir automatique (maintien du clic) ou semi (un événement par clic). */
  auto: boolean;
  /** Dégâts de base par balle (avant chute de distance / headshot). */
  damage: number;
  /** Multiplicateur tête (HEADSHOT_MULTIPLIER = 2 pour toutes). */
  headMult: number;
  /** Cadence (rounds par minute). Intervalle min entre tirs = 60000/rpm ms. */
  rpm: number;
  /** Taille du chargeur. */
  magSize: number;
  /** Munitions de réserve au spawn (hors chargeur). */
  reserveAmmo: number;
  /** Durée du rechargement (ms). */
  reloadMs: number;
  /** Temps de transition vers/depuis l'ADS (ms). */
  adsMs: number;
  /** Facteur de zoom ADS appliqué au FOV de base (ex. 0.5 = FOV divisé par 2).
   *  Pour le sniper : 0.25 = zoom x4. */
  adsFovMult: number;
  recoil: RecoilSpec;
  spread: SpreadSpec;
  /** Chute de dégâts avec la distance, ou null = dégâts constants. */
  falloff: FalloffSpec | null;
  /** Multiplicateur de mobilité (appliqué aux vitesses de sim.ts). */
  mobility: number;
  /** Temps (ms) après un switch avant de pouvoir tirer (draw time). */
  drawMs: number;
}

// ----------------------------------------------------------------------------
// Les 4 armes (valeurs imposées par le game design)
// ----------------------------------------------------------------------------

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  // Fusil d'assaut polyvalent.
  vsk27: {
    id: 'vsk27',
    name: 'VSK-27',
    slot: 0,
    auto: true,
    damage: 30,
    headMult: HEADSHOT_MULTIPLIER,
    rpm: 625,
    magSize: 30,
    reserveAmmo: 120,
    reloadMs: 2200,
    adsMs: 220,
    adsFovMult: 0.8, // zoom léger x1.25
    recoil: { vertical: 0.55, horizontal: 0.25 },
    spread: { hip: 2.2, ads: 0.35 },
    falloff: { start: 25, end: 60, minMult: 0.6 }, // -40 % à 60 m
    mobility: 1.0,
    drawMs: 400,
  },
  // Pistolet-mitrailleur CQC : cadence + mobilité.
  kv9: {
    id: 'kv9',
    name: 'KV-9',
    slot: 0,
    auto: true,
    damage: 24,
    headMult: HEADSHOT_MULTIPLIER,
    rpm: 750,
    magSize: 32,
    reserveAmmo: 128,
    reloadMs: 2000,
    adsMs: 180,
    adsFovMult: 0.85,
    recoil: { vertical: 0.45, horizontal: 0.3 },
    spread: { hip: 2.8, ads: 0.5 },
    falloff: { start: 25, end: 60, minMult: 0.6 },
    mobility: 1.06, // mobilité +
    drawMs: 350,
  },
  // Sniper à verrou : OHK torse à toute distance, scope x4.
  // 105 > HP_MAX pour garantir le one-hit-kill torse annoncé (« Une balle,
  // une mort ») même après un début de régénération.
  lr50: {
    id: 'lr50',
    name: 'LR-50',
    slot: 0,
    auto: false, // verrou : un tir par action, cadence ~45 RPM
    damage: 105,
    headMult: HEADSHOT_MULTIPLIER,
    rpm: 45,
    magSize: 5,
    reserveAmmo: 25,
    reloadMs: 3000,
    adsMs: 350,
    adsFovMult: 0.25, // zoom x4
    recoil: { vertical: 3.5, horizontal: 0.6 },
    spread: { hip: 6.0, ads: 0.05 },
    falloff: null, // dégâts constants (imposé)
    mobility: 0.95,
    drawMs: 550,
  },
  // Pistolet de poche, partagé par toutes les classes.
  p9: {
    id: 'p9',
    name: 'P9',
    slot: 1,
    auto: false, // semi
    damage: 34,
    headMult: HEADSHOT_MULTIPLIER,
    rpm: 320, // cadence max du semi (anti-macro)
    magSize: 12,
    reserveAmmo: 48,
    reloadMs: 1600,
    adsMs: 150,
    adsFovMult: 0.9,
    recoil: { vertical: 0.8, horizontal: 0.2 },
    spread: { hip: 1.6, ads: 0.4 },
    falloff: { start: 20, end: 50, minMult: 0.65 },
    mobility: 1.08,
    drawMs: 250,
  },
  // ---- Emplacements d'armes CUSTOM (armurerie communautaire) ---------------
  // Base neutre type fusil d'assaut ; nom/stats/modèle définis par le pack du
  // salon (weaponMods), assignés aux classes via `loadouts`.
  custom1: makeCustomSpec('custom1', 'CUSTOM 1'),
  custom2: makeCustomSpec('custom2', 'CUSTOM 2'),
  custom3: makeCustomSpec('custom3', 'CUSTOM 3'),
};

/** Spec de base d'un emplacement custom (équilibrage neutre type AR). */
function makeCustomSpec(id: WeaponId, name: string): WeaponSpec {
  return {
    id,
    name,
    slot: 0,
    auto: true,
    damage: 28,
    headMult: HEADSHOT_MULTIPLIER,
    rpm: 600,
    magSize: 30,
    reserveAmmo: 120,
    reloadMs: 2200,
    adsMs: 220,
    adsFovMult: 0.8,
    recoil: { vertical: 0.55, horizontal: 0.25 },
    spread: { hip: 2.4, ads: 0.4 },
    falloff: { start: 25, end: 60, minMult: 0.6 },
    mobility: 1.0,
    drawMs: 400,
  };
}

export const WEAPON_IDS: WeaponId[] = ['vsk27', 'kv9', 'lr50', 'p9', 'custom1', 'custom2', 'custom3'];

export function getWeapon(id: WeaponId): WeaponSpec {
  return WEAPONS[id];
}

/** Intervalle minimal entre deux tirs validés (ms) — utilisé par le serveur. */
export function minShotIntervalMs(id: WeaponId): number {
  return 60000 / WEAPONS[id].rpm;
}

// ----------------------------------------------------------------------------
// Classes prédéfinies (3)
// ----------------------------------------------------------------------------

export interface ClassDef {
  id: ClassId;
  /** Nom affiché en français. */
  name: string;
  /** Description courte pour l'écran de sélection. */
  description: string;
  /** [primaire, secondaire] — toujours P9 en secondaire (imposé). */
  loadout: [WeaponId, WeaponId];
}

export const CLASS_DEFS: Record<ClassId, ClassDef> = {
  assault: {
    id: 'assault',
    name: 'Assaut',
    description: 'Fusil d\'assaut VSK-27 polyvalent, efficace à toutes distances.',
    loadout: ['vsk27', 'p9'],
  },
  cqc: {
    id: 'cqc',
    name: 'CQC',
    description: 'Pistolet-mitrailleur KV-9 : cadence infernale et mobilité accrue.',
    loadout: ['kv9', 'p9'],
  },
  recon: {
    id: 'recon',
    name: 'Recon',
    description: 'Sniper LR-50 à verrou : élimination en une balle bien placée.',
    loadout: ['lr50', 'p9'],
  },
};

export const CLASS_IDS: ClassId[] = ['assault', 'cqc', 'recon'];

export function getClass(id: ClassId): ClassDef {
  return CLASS_DEFS[id];
}

/** Arme d'un slot donné pour une classe. */
export function weaponForSlot(classId: ClassId, slot: WeaponSlot): WeaponId {
  return CLASS_DEFS[classId].loadout[slot];
}

// ----------------------------------------------------------------------------
// État d'arme runtime (utilisé côté serveur, miroir côté client pour le HUD)
// ----------------------------------------------------------------------------

export interface WeaponState {
  id: WeaponId;
  /** Balles restantes dans le chargeur. */
  mag: number;
  /** Munitions de réserve. */
  reserve: number;
  /** Timestamp (ms) de fin de reload en cours, 0 si pas de reload. */
  reloadingUntil: number;
}

/** Crée l'état d'arme initial (chargeur plein + réserve complète).
 *  `spec` optionnel : table d'armes du SALON (stats moddées) — défaut : table
 *  partagée (côté client, mutée par les mods du salon courant). */
export function makeWeaponState(id: WeaponId, spec: WeaponSpec = WEAPONS[id]): WeaponState {
  return { id, mag: spec.magSize, reserve: spec.reserveAmmo, reloadingUntil: 0 };
}

// ----------------------------------------------------------------------------
// Hypothèses
// ----------------------------------------------------------------------------
// 1. P9 : le cahier des charges ne fixe pas sa cadence ni sa chute de dégâts ;
//    semi à 320 RPM max (anti-macro) et chute 20 m -> 50 m (-35 %) pour rester
//    cohérent avec le rôle « secondaire d'appoint ».
// 2. LR-50 « ~45 RPM » : fixé à 45 exactement ; `auto: false` force un clic par
//    balle (verrou), le serveur valide l'intervalle via minShotIntervalMs.
// 3. adsFovMult (et non un FOV absolu) : le client choisit son FOV de base
//    (ex. 75°) et multiplie ; zoom x4 <=> mult 0.25.
// 4. mobility est passée comme 5e argument (`speedMult`) à stepBody de sim.ts,
//    côté client (prédiction) comme côté serveur (autorité) : la signature de
//    stepBody reste indépendante des armes et la prédiction est exacte.
// 5. Recul : valeurs en degrés PAR BALLE ; le client les applique à la caméra
//    (kick vertical + bruit horizontal ±), le serveur n'a pas besoin de les
//    connaître car la direction exacte arrive déjà dans ShootMsg.
