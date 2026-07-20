// ============================================================================
// STRIKE 2025 — server/MapLibrary.ts
// Bibliothèque des maps de la communauté : chaque map publiée depuis
// l'éditeur est un fichier data/maps/<slug>.json contenant l'état d'édition
// complet (objets placés + éditions de la map de base) et ses métadonnées
// (nom, auteur, date). Les salons (Rooms) chargent une map de la bibliothèque
// à leur création. Garde de MAP_VERSION identique à CustomMap.
// ============================================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAP_VERSION } from '../src/shared/map.js';
import type { MapState } from '../src/shared/mapObjects.js';
import { sanitizeBaseEdits, sanitizePlacedObjects, sanitizeProps } from '../src/shared/mapObjects.js';
import { sanitizeLoadouts, sanitizeWeaponMods } from '../src/shared/weaponMods.js';

const MAPS_DIR = path.resolve(process.cwd(), 'data', 'maps');
/** Nombre max de maps publiées (garde-fou disque). */
const MAX_MAPS = 100;

export interface MapMetaInfo {
  slug: string;
  name: string;
  author: string;
  createdAt: number;
  objectCount: number;
  baseEditCount: number;
}

interface MapFile {
  version: 2;
  mapVersion: number;
  name: string;
  author: string;
  createdAt: number;
  objects: unknown;
  baseEdits: unknown;
  weaponMods?: unknown;
  loadouts?: unknown;
  props?: unknown;
  baseTerrain?: unknown;
}

/** Nettoie un nom affichable (map ou auteur) : 1..24 caractères sûrs. */
export function sanitizeLabel(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const s = raw.trim().replace(/[^\p{L}\p{N} _\-']/gu, '').slice(0, 24);
  return s.length > 0 ? s : fallback;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base.length > 0 ? base : 'map';
}

function fileFor(slug: string): string {
  return path.join(MAPS_DIR, `${slug}.json`);
}

function readMapFile(slug: string): MapFile | null {
  try {
    const raw = JSON.parse(readFileSync(fileFor(slug), 'utf8')) as MapFile;
    if (typeof raw !== 'object' || raw === null) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Liste les maps publiées (métadonnées seulement), plus récentes d'abord. */
export function listMaps(): MapMetaInfo[] {
  if (!existsSync(MAPS_DIR)) return [];
  const out: MapMetaInfo[] = [];
  for (const f of readdirSync(MAPS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const slug = f.slice(0, -5);
    const data = readMapFile(slug);
    if (!data) continue;
    const objects = Array.isArray(data.objects) ? data.objects.length : 0;
    const baseEdits = Array.isArray(data.baseEdits) ? data.baseEdits.length : 0;
    out.push({
      slug,
      name: sanitizeLabel(data.name, slug),
      author: sanitizeLabel(data.author, 'anonyme'),
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
      objectCount: objects,
      baseEditCount: baseEdits,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Charge l'état d'édition d'une map publiée (sanitisé). null si absente ou
 *  si ses éditions de base datent d'une autre version de la map de base. */
export function loadMap(slug: string): { meta: MapMetaInfo; state: MapState } | null {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  const data = readMapFile(slug);
  if (data === null) return null;
  const props = sanitizeProps(data.props);
  const objects = sanitizePlacedObjects(data.objects, props);
  const baseEdits = data.mapVersion === MAP_VERSION ? sanitizeBaseEdits(data.baseEdits) : [];
  const weaponMods = sanitizeWeaponMods(data.weaponMods);
  const loadouts = sanitizeLoadouts(data.loadouts);
  return {
    meta: {
      slug,
      name: sanitizeLabel(data.name, slug),
      author: sanitizeLabel(data.author, 'anonyme'),
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
      objectCount: objects.length,
      baseEditCount: baseEdits.length,
    },
    state: { objects, baseEdits, weaponMods, loadouts, props, baseTerrain: data.baseTerrain === 'flat' ? 'flat' : 'kestrel' },
  };
}

/** Suppression ADMIN d'une map publiée. Les salons qui la jouent déjà gardent
 *  leur copie en mémoire (fermables séparément depuis le panel). */
export function deleteMap(slug: string): boolean {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return false;
  try {
    if (!existsSync(fileFor(slug))) return false;
    unlinkSync(fileFor(slug));
    console.log(`[maps] map supprimée par un admin : ${slug}.json`);
    return true;
  } catch (err) {
    console.error('[maps] échec de suppression :', err);
    return false;
  }
}

/** Publie une map (écriture atomique). Retourne son slug (suffixé si le nom
 *  est déjà pris), ou null si la bibliothèque est pleine / données vides. */
export function publishMap(
  rawName: unknown,
  rawAuthor: unknown,
  rawObjects: unknown,
  rawBaseEdits: unknown,
  rawWeaponMods?: unknown,
  rawLoadouts?: unknown,
  rawProps?: unknown,
  rawTerrain?: unknown,
): { slug: string; name: string } | null {
  const name = sanitizeLabel(rawName, 'Ma map');
  const author = sanitizeLabel(rawAuthor, 'anonyme');
  const props = sanitizeProps(rawProps);
  const objects = sanitizePlacedObjects(rawObjects, props);
  const baseEdits = sanitizeBaseEdits(rawBaseEdits);
  const weaponMods = sanitizeWeaponMods(rawWeaponMods);
  const loadouts = sanitizeLoadouts(rawLoadouts);
  const baseTerrain = rawTerrain === 'flat' ? 'flat' as const : 'kestrel' as const;
  if (objects.length === 0 && baseEdits.length === 0 && Object.keys(weaponMods).length === 0 && baseTerrain === 'kestrel') return null;
  mkdirSync(MAPS_DIR, { recursive: true });
  if (listMaps().length >= MAX_MAPS) return null;
  let slug = slugify(name);
  for (let i = 2; existsSync(fileFor(slug)) && i <= 20; i++) {
    slug = `${slugify(name)}-${i}`;
  }
  if (existsSync(fileFor(slug))) return null;
  const data: MapFile = {
    version: 2,
    mapVersion: MAP_VERSION,
    name,
    author,
    createdAt: Date.now(),
    objects,
    baseEdits,
    weaponMods,
    loadouts,
    props,
    baseTerrain,
  };
  try {
    const tmp = fileFor(slug) + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
    renameSync(tmp, fileFor(slug));
    console.log(`[maps] map publiée : « ${name} » par ${author} -> ${slug}.json`);
    return { slug, name };
  } catch (err) {
    console.error('[maps] échec de publication :', err);
    return null;
  }
}
