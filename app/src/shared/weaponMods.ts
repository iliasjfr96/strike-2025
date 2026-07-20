// ============================================================================
// STRIKE 2025 — weaponMods.ts
// Armurerie : surcharge des stats d'armes et des modèles 3D par SALON.
//  - sanitizeWeaponMods : validation + BORNES anti-triche (un salon moddé ne
//    peut pas produire une arme absurde : dégâts 1-250, cadence 30-1500…)
//  - mergedWeaponSpec / buildWeaponTable : fusion stats d'origine + mods —
//    utilisée par le SERVEUR (table par Game/salon, jamais de mutation
//    globale) et par le client.
//  - applyWeaponModsToClient : le CLIENT (mono-salon) mute la table WEAPONS
//    partagée en place depuis un clone d'origine — prédiction, HUD, cadence
//    et loadout voient les stats du salon sans autre branchement.
// TypeScript pur — importable des deux côtés.
// ============================================================================

import type {
  ClassId,
  ClassLoadouts,
  WeaponId,
  WeaponModelMod,
  WeaponModsConfig,
  WeaponStatsMod,
} from './protocol';
import type { WeaponSpec } from './weapons';
import { CLASS_DEFS, WEAPONS } from './weapons';

// ----------------------------------------------------------------------------
// Bornes anti-triche (min, max) par stat
// ----------------------------------------------------------------------------

export const STAT_LIMITS: Record<Exclude<keyof WeaponStatsMod, 'auto' | 'name'>, [number, number]> = {
  damage: [1, 250],
  rpm: [30, 1500],
  magSize: [1, 200],
  reserveAmmo: [0, 990],
  reloadMs: [200, 10000],
  adsMs: [50, 2000],
  adsFovMult: [0.15, 1],
  recoilV: [0, 15],
  recoilH: [0, 8],
  spreadHip: [0, 20],
  spreadAds: [0, 10],
  mobility: [0.5, 1.6],
  drawMs: [100, 3000],
};

/** Bornes de calibration d'un modèle custom. */
export const MODEL_LIMITS = {
  rotY: [-6.3, 6.3] as [number, number],
  realLength: [0.1, 2.5] as [number, number],
  adsY: [0, 0.5] as [number, number],
  muzzleY: [-0.2, 0.5] as [number, number],
};

/** Chemin de fichier modèle autorisé (uploadé par NOTRE serveur uniquement).
 *  Formats supportés : GLB (recommandé — tout embarqué), GLTF embarqué, FBX,
 *  OBJ, STL (les deux derniers : matériau par défaut, pas de textures). */
const MODEL_FILE_RE = /^\/mods\/models\/[a-z0-9]{8,64}\.(glb|gltf|fbx|obj|stl)$/;
/** Chemin de texture autorisé (uploadée via /mods/textures). */
const TEXTURE_FILE_RE = /^\/mods\/textures\/[a-z0-9]{8,64}\.(png|jpg|webp)$/;

const WEAPON_IDS: WeaponId[] = ['vsk27', 'kv9', 'lr50', 'p9', 'custom1', 'custom2', 'custom3'];
const CLASS_IDS_LOCAL: ClassId[] = ['assault', 'cqc', 'recon'];

function clampNum(v: unknown, [min, max]: [number, number]): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const c = Math.min(max, Math.max(min, v));
  return Math.round(c * 1000) / 1000;
}

// ----------------------------------------------------------------------------
// Sanitisation (fichier disque / POST réseau)
// ----------------------------------------------------------------------------

export function sanitizeWeaponMods(raw: unknown): WeaponModsConfig {
  const out: WeaponModsConfig = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const id of WEAPON_IDS) {
    const entryRaw = (raw as Record<string, unknown>)[id];
    if (typeof entryRaw !== 'object' || entryRaw === null) continue;
    const e = entryRaw as { stats?: unknown; model?: unknown };
    const entry: { stats?: WeaponStatsMod; model?: WeaponModelMod } = {};

    if (typeof e.stats === 'object' && e.stats !== null) {
      const s = e.stats as Record<string, unknown>;
      const stats: WeaponStatsMod = {};
      for (const key of Object.keys(STAT_LIMITS) as (keyof typeof STAT_LIMITS)[]) {
        const v = clampNum(s[key], STAT_LIMITS[key]);
        if (v !== undefined && v !== defaultStatValue(id, key)) (stats as Record<string, number>)[key] = v;
      }
      if (typeof s.auto === 'boolean' && s.auto !== WEAPONS_ORIGINAL[id].auto) stats.auto = s.auto;
      if (typeof s.name === 'string') {
        const name = s.name.trim().replace(/[^\p{L}\p{N} _\-'.]/gu, '').slice(0, 20);
        if (name.length > 0 && name !== WEAPONS_ORIGINAL[id].name) stats.name = name;
      }
      if (Object.keys(stats).length > 0) entry.stats = stats;
    }

    if (typeof e.model === 'object' && e.model !== null) {
      const m = e.model as Record<string, unknown>;
      const rotY = clampNum(m.rotY, MODEL_LIMITS.rotY);
      const realLength = clampNum(m.realLength, MODEL_LIMITS.realLength);
      const adsY = clampNum(m.adsY, MODEL_LIMITS.adsY);
      const muzzleY = clampNum(m.muzzleY, MODEL_LIMITS.muzzleY);
      if (
        typeof m.file === 'string' &&
        MODEL_FILE_RE.test(m.file) &&
        rotY !== undefined &&
        realLength !== undefined &&
        adsY !== undefined &&
        muzzleY !== undefined
      ) {
        entry.model = { file: m.file, rotY, realLength, adsY, muzzleY };
        if (typeof m.map === 'string' && TEXTURE_FILE_RE.test(m.map)) {
          entry.model.map = m.map;
        }
        if (typeof m.normalMap === 'string' && TEXTURE_FILE_RE.test(m.normalMap)) {
          entry.model.normalMap = m.normalMap;
        }
      }
    }

    if (entry.stats || entry.model) out[id] = entry;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Fusion stats d'origine + mods
// ----------------------------------------------------------------------------

/** Clone IMMUABLE des specs d'origine (avant toute mutation client). */
export const WEAPONS_ORIGINAL: Record<WeaponId, WeaponSpec> = Object.fromEntries(
  WEAPON_IDS.map((id) => [
    id,
    {
      ...WEAPONS[id],
      recoil: { ...WEAPONS[id].recoil },
      spread: { ...WEAPONS[id].spread },
      falloff: WEAPONS[id].falloff ? { ...WEAPONS[id].falloff } : null,
    },
  ]),
) as Record<WeaponId, WeaponSpec>;

function defaultStatValue(id: WeaponId, key: keyof typeof STAT_LIMITS): number {
  const o = WEAPONS_ORIGINAL[id];
  switch (key) {
    case 'recoilV': return o.recoil.vertical;
    case 'recoilH': return o.recoil.horizontal;
    case 'spreadHip': return o.spread.hip;
    case 'spreadAds': return o.spread.ads;
    default: return o[key];
  }
}

/** Spec fusionnée (NOUVEL objet — aucune mutation des données d'origine). */
export function mergedWeaponSpec(id: WeaponId, mods: WeaponModsConfig): WeaponSpec {
  const o = WEAPONS_ORIGINAL[id];
  const s = mods[id]?.stats;
  return {
    ...o,
    name: s?.name ?? o.name,
    auto: s?.auto ?? o.auto,
    damage: s?.damage ?? o.damage,
    rpm: s?.rpm ?? o.rpm,
    magSize: s?.magSize !== undefined ? Math.round(s.magSize) : o.magSize,
    reserveAmmo: s?.reserveAmmo !== undefined ? Math.round(s.reserveAmmo) : o.reserveAmmo,
    reloadMs: s?.reloadMs ?? o.reloadMs,
    adsMs: s?.adsMs ?? o.adsMs,
    adsFovMult: s?.adsFovMult ?? o.adsFovMult,
    recoil: { vertical: s?.recoilV ?? o.recoil.vertical, horizontal: s?.recoilH ?? o.recoil.horizontal },
    spread: { hip: s?.spreadHip ?? o.spread.hip, ads: s?.spreadAds ?? o.spread.ads },
    falloff: o.falloff ? { ...o.falloff } : null,
    mobility: s?.mobility ?? o.mobility,
    drawMs: s?.drawMs ?? o.drawMs,
  };
}

/** Table d'armes complète d'un salon (serveur : une par Game). */
export function buildWeaponTable(mods: WeaponModsConfig): Record<WeaponId, WeaponSpec> {
  return Object.fromEntries(WEAPON_IDS.map((id) => [id, mergedWeaponSpec(id, mods)])) as Record<
    WeaponId,
    WeaponSpec
  >;
}

/**
 * CLIENT UNIQUEMENT : applique les mods du salon courant en MUTANT la table
 * WEAPONS partagée (prédiction, cadence, HUD, loadout la lisent directement).
 */
export function applyWeaponModsToClient(mods: WeaponModsConfig): void {
  for (const id of WEAPON_IDS) {
    const merged = mergedWeaponSpec(id, mods);
    const target = WEAPONS[id] as WeaponSpec;
    Object.assign(target, merged, {
      recoil: { ...merged.recoil },
      spread: { ...merged.spread },
      falloff: merged.falloff,
    });
  }
}

// ----------------------------------------------------------------------------
// Loadouts remappés (armes custom assignées aux classes)
// ----------------------------------------------------------------------------

/** Loadouts d'origine (clonés avant toute mutation client). */
export const CLASS_LOADOUTS_ORIGINAL: Record<ClassId, [WeaponId, WeaponId]> = Object.fromEntries(
  CLASS_IDS_LOCAL.map((c) => [c, [...CLASS_DEFS[c].loadout] as [WeaponId, WeaponId]]),
) as Record<ClassId, [WeaponId, WeaponId]>;

/** Sanitise des loadouts bruts : classes/armes connues uniquement. */
export function sanitizeLoadouts(raw: unknown): ClassLoadouts {
  const out: ClassLoadouts = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const c of CLASS_IDS_LOCAL) {
    const entry = (raw as Record<string, unknown>)[c];
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [w0, w1] = entry as unknown[];
    if (
      typeof w0 === 'string' && (WEAPON_IDS as string[]).includes(w0) &&
      typeof w1 === 'string' && (WEAPON_IDS as string[]).includes(w1)
    ) {
      const pair: [WeaponId, WeaponId] = [w0 as WeaponId, w1 as WeaponId];
      const orig = CLASS_LOADOUTS_ORIGINAL[c];
      if (pair[0] !== orig[0] || pair[1] !== orig[1]) out[c] = pair;
    }
  }
  return out;
}

/** Table de loadouts complète d'un salon (serveur : une par Game). */
export function buildLoadoutTable(loadouts: ClassLoadouts): Record<ClassId, [WeaponId, WeaponId]> {
  return Object.fromEntries(
    CLASS_IDS_LOCAL.map((c) => [c, [...(loadouts[c] ?? CLASS_LOADOUTS_ORIGINAL[c])] as [WeaponId, WeaponId]]),
  ) as Record<ClassId, [WeaponId, WeaponId]>;
}

/** CLIENT UNIQUEMENT : mute CLASS_DEFS en place — resetWeapons, HUD,
 *  PlayersRenderer et Crosshair voient les loadouts du salon. */
export function applyLoadoutsToClient(loadouts: ClassLoadouts): void {
  for (const c of CLASS_IDS_LOCAL) {
    const pair = loadouts[c] ?? CLASS_LOADOUTS_ORIGINAL[c];
    CLASS_DEFS[c].loadout[0] = pair[0];
    CLASS_DEFS[c].loadout[1] = pair[1];
  }
}
