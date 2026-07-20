// ============================================================================
// STRIKE 2025 — mapObjects.ts
// Objets plaçables par l'éditeur de map (mode build) : palette de types
// (dimensions + texture), validation/sanitisation des données persistées, et
// application aux COLLIDERS partagés (mutation en place de MAP_COLLIDERS —
// même tableau référencé par la sim client, la sim serveur et les raycasts).
// Contrainte moteur : collisions AABB -> rotations par quarts de tour
// uniquement (rot 0-3 ; impair = dimensions X/Z échangées).
// TypeScript pur : aucun DOM, aucun Node — importable des deux côtés.
// ============================================================================

import type { BaseTerrain, CustomPropDef, GameModeConfig, MapBaseEdit, PlacedObject } from './protocol';
import { MAP_BOUNDS, MAP_COLLIDERS } from './map';
import type { MapBox } from './map';
import type { AABB } from './sim';
import { aabbFromBase } from './sim';

/** Définition d'un type d'objet plaçable. */
export interface MapObjectDef {
  /** Libellé FR affiché dans la palette. */
  label: string;
  /** Dimensions [x, y, z] en mètres (rot 0). */
  size: [number, number, number];
  /** Id de texture Poly Haven (public/textures/kestrel/<id>_*_1k.jpg). */
  tex: string;
  /** Teinte appliquée à la texture (blanc = brute). */
  color: string;
}

/** Palette de l'éditeur. Les hauteurs ≤ 0.45 m sont enjambables (STEP_HEIGHT),
 *  au-delà elles bloquent — empiler des `platform` fait des escaliers. */
export const MAP_OBJECT_DEFS: Record<string, MapObjectDef> = {
  crate: { label: 'Caisse bois', size: [1, 1, 1], tex: 'brown_planks_03', color: '#ffffff' },
  crate_big: { label: 'Grande caisse', size: [2, 1.2, 1.2], tex: 'brown_planks_03', color: '#d8cdb8' },
  crate_metal: { label: 'Caisse métal', size: [1.2, 1.2, 1.2], tex: 'blue_metal_plate', color: '#8a97a1' },
  container: { label: 'Container', size: [6, 2.6, 2.4], tex: 'container_side', color: '#ffffff' },
  container_blue: { label: 'Container bleu', size: [6, 2.6, 2.4], tex: 'blue_metal_plate', color: '#7f9fc4' },
  container_green: { label: 'Container vert', size: [6, 2.6, 2.4], tex: 'container_side', color: '#4e7a52' },
  container_orange: { label: 'Container orange', size: [6, 2.6, 2.4], tex: 'container_side', color: '#b35c26' },
  container_teal: { label: 'Container teal', size: [6, 2.6, 2.4], tex: 'container_side', color: '#2e6f6a' },
  container_red: { label: 'Container rouille', size: [6, 2.6, 2.4], tex: 'container_side', color: '#9c4a2f' },
  wall_low: { label: 'Muret béton', size: [3, 1.2, 0.4], tex: 'concrete', color: '#ffffff' },
  wall_high: { label: 'Mur béton', size: [4, 3, 0.35], tex: 'concrete', color: '#cfcfcf' },
  barrier: { label: 'Barrière métal', size: [2, 1.05, 0.18], tex: 'rusty_metal', color: '#ffffff' },
  barrier_concrete: { label: 'Barrière béton', size: [3, 1.1, 0.45], tex: 'concrete', color: '#c9ced2' },
  platform: { label: 'Plateforme (0.45)', size: [3, 0.45, 3], tex: 'metal_grate_rusty', color: '#ffffff' },
  platform_high: { label: 'Plateforme haute (0.9)', size: [3, 0.9, 3], tex: 'metal_grate_rusty', color: '#d6dade' },
  platform_xl: { label: 'Plateforme XL (1.35)', size: [3, 1.35, 3], tex: 'metal_grate_rusty', color: '#c2c8ce' },
  platform_big: { label: 'Grande plateforme', size: [4, 0.45, 4], tex: 'metal_grate_rusty', color: '#ffffff' },
  block: { label: 'Bloc béton', size: [1.6, 0.8, 1.6], tex: 'concrete_floor', color: '#ffffff' },
  blocks: { label: 'Parpaings', size: [1.6, 0.8, 0.8], tex: 'concrete', color: '#b9bfc4' },
  pillar: { label: 'Pilier', size: [0.6, 3, 0.6], tex: 'factory_wall', color: '#b9bec4' },
  shed: { label: 'Abri tôle', size: [4, 2.4, 3], tex: 'worn_corrugated_iron', color: '#8fa08a' },
  // ---- Nouveautés : mobilier et props industriels ----
  barrel_metal: { label: 'Fût métal', size: [0.6, 0.9, 0.6], tex: 'rusty_metal', color: '#8a6a4a' },
  barrel_blue: { label: 'Fût bleu', size: [0.6, 0.9, 0.6], tex: 'blue_metal_plate', color: '#5f7f9f' },
  pallet: { label: 'Palette', size: [1.2, 0.15, 1.0], tex: 'brown_planks_03', color: '#c9b391' },
  pallet_stack: { label: 'Palettes empilées', size: [1.2, 0.6, 1.0], tex: 'brown_planks_03', color: '#b9a381' },
  sandbags: { label: 'Sacs de sable', size: [2.2, 1.0, 0.8], tex: 'gravel_floor_02', color: '#c8b491' },
  tire_stack: { label: 'Pile de pneus', size: [0.8, 1.0, 0.8], tex: 'rusty_metal', color: '#26292c' },
  tank: { label: 'Citerne', size: [3.0, 1.6, 1.6], tex: 'rusty_metal', color: '#9a8a6a' },
  fence_metal: { label: 'Grillage métal', size: [3, 2, 0.1], tex: 'metal_grate_rusty', color: '#9aa2a8' },
  pipe: { label: 'Tuyau industrie', size: [2.5, 0.5, 0.5], tex: 'rusty_metal', color: '#7a6a55' },
  beam: { label: 'Poutre acier', size: [4, 0.3, 0.3], tex: 'rusty_metal', color: '#5a5f64' },
  scaffold: { label: 'Échafaudage', size: [2, 3, 1], tex: 'metal_grate_rusty', color: '#a0a6ab' },
  desk_metal: { label: 'Établi', size: [1.8, 0.9, 0.8], tex: 'factory_wall', color: '#7d838a' },
  locker: { label: 'Casier', size: [0.8, 1.9, 0.5], tex: 'blue_metal_plate', color: '#6f8194' },
  sign_panel: { label: 'Panneau', size: [1.5, 1.0, 0.1], tex: 'painted_metal_shutter', color: '#c9c9c9' },
  gravel_heap: { label: 'Tas de gravier', size: [2, 0.8, 2], tex: 'gravel_floor_02', color: '#b9b4ac' },
  cone: { label: 'Cône chantier', size: [0.4, 0.8, 0.4], tex: 'rusty_metal', color: '#d96a1e' },
};

/** Nombre max d'objets persistés (garde-fou perf/réseau). */
export const MAX_PLACED_OBJECTS = 400;

/** Bornes de l'échelle par axe. */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 5;

/** ZONES de mode de jeu (marqueurs SANS collision, posés dans l'éditeur) :
 *  'zone:capture' = point de capture (domination) · 'zone:bombsite' = site de
 *  bombe (R&D). L'empreinte XZ (échelle molette comprise) définit l'aire
 *  jouable ; la hauteur est fixe. */
export const ZONE_SIZES: Record<string, [number, number, number]> = {
  'zone:capture': [8, 3, 8],
  'zone:bombsite': [7, 3, 7],
  // Spawns d'équipe plaçables (plusieurs par équipe = plusieurs points).
  'zone:spawn0': [5, 3, 5],
  'zone:spawn1': [5, 3, 5],
};

/** Nombre max de marqueurs de spawn par équipe. */
export const MAX_SPAWN_MARKERS = 8;

/** Vrai si ce kind est une zone de mode (jamais dans les colliders). */
export function isZoneKind(kind: string): boolean {
  return kind.startsWith('zone:');
}

/** Rectangle XZ d'une zone placée (échelle + rotation appliquées). */
export interface ZoneRect {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  y: number;
}

/** Rectangles des zones d'un kind, dans l'ORDRE DE PLACEMENT (c'est cet ordre
 *  qui numérote les zones A, B, C… côté serveur ET client). */
export function zoneRectsFromObjects(objects: PlacedObject[], kind: string, max: number): ZoneRect[] {
  const base = ZONE_SIZES[kind];
  if (!base) return [];
  const out: ZoneRect[] = [];
  for (const o of objects) {
    if (o.kind !== kind) continue;
    const sx = base[0] * (o.sx ?? 1);
    const sz = base[2] * (o.sz ?? 1);
    const odd = o.rot % 2 === 1;
    out.push({
      cx: o.x,
      cz: o.z,
      hx: (odd ? sz : sx) / 2,
      hz: (odd ? sx : sz) / 2,
      y: o.y,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Position (pieds) dans le volume d'une zone (marge verticale tolérante). */
export function posInZone(x: number, y: number, z: number, zone: ZoneRect): boolean {
  return (
    Math.abs(x - zone.cx) <= zone.hx &&
    Math.abs(z - zone.cz) <= zone.hz &&
    y >= zone.y - 1.2 &&
    y <= zone.y + 3.5
  );
}

/** Dimensions de BASE d'un kind (palette intégrée, prop custom ou zone). */
export function baseSizeForKind(kind: string, props?: CustomPropDef[]): [number, number, number] | null {
  if (kind.startsWith('prop:')) {
    const def = props?.find((p) => p.id === kind.slice(5));
    return def ? [def.sizeX, def.sizeY, def.sizeZ] : null;
  }
  if (isZoneKind(kind)) {
    const size = ZONE_SIZES[kind];
    return size ? [size[0], size[1], size[2]] : null;
  }
  const def = MAP_OBJECT_DEFS[kind];
  return def ? [def.size[0], def.size[1], def.size[2]] : null;
}

/** Dimensions en espace OBJET (échelle appliquée, avant rotation). */
export function scaledSize(o: PlacedObject, props?: CustomPropDef[]): [number, number, number] | null {
  const size = baseSizeForKind(o.kind, props);
  if (!size) return null;
  return [size[0] * (o.sx ?? 1), size[1] * (o.sy ?? 1), size[2] * (o.sz ?? 1)];
}

/** AABB de collision d'un objet placé (rot impair = X/Z échangés). */
export function placedObjectAABB(o: PlacedObject, props?: CustomPropDef[]): AABB | null {
  const size = scaledSize(o, props);
  if (!size) return null;
  const [sx, sy, sz] = size;
  const odd = o.rot % 2 === 1;
  return aabbFromBase(o.x, o.y, o.z, odd ? sz : sx, sy, odd ? sx : sz);
}

function isFinite3(...ns: number[]): boolean {
  return ns.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Sanitise une liste brute (fichier disque / POST réseau) : types, bornes de
 *  la map, kinds connus (palette + props du pack), ids réattribués. */
export function sanitizePlacedObjects(raw: unknown, props?: CustomPropDef[]): PlacedObject[] {
  if (!Array.isArray(raw)) return [];
  const out: PlacedObject[] = [];
  let id = 1;
  for (const item of raw) {
    if (out.length >= MAX_PLACED_OBJECTS) break;
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.kind !== 'string') continue;
    if (!(o.kind in MAP_OBJECT_DEFS) && baseSizeForKind(o.kind, props) === null) continue;
    const x = o.x as number;
    const y = o.y as number;
    const z = o.z as number;
    if (!isFinite3(x, y, z)) continue;
    // Bornes larges (×2) : la map peut être agrandie jusqu'à 200 % (mapScale).
    if (x < MAP_BOUNDS.minX * 2 - 2 || x > MAP_BOUNDS.maxX * 2 + 2) continue;
    if (z < MAP_BOUNDS.minZ * 2 - 2 || z > MAP_BOUNDS.maxZ * 2 + 2) continue;
    if (y < 0 || y > 30) continue;
    const rotRaw = typeof o.rot === 'number' ? Math.round(o.rot) : 0;
    const rot = (((rotRaw % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    const clean: PlacedObject = {
      id: id++,
      kind: o.kind,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      z: Math.round(z * 100) / 100,
      rot,
    };
    // Échelles optionnelles (clampées, omises quand neutres).
    for (const axis of ['sx', 'sy', 'sz'] as const) {
      const v = o[axis];
      if (typeof v === 'number' && Number.isFinite(v)) {
        const s = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, v)) * 100) / 100;
        if (s !== 1) clean[axis] = s;
      }
    }
    out.push(clean);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Map de base éditable + application aux collisions partagées (client/serveur)
// ----------------------------------------------------------------------------

/** Clone IMMUABLE des boîtes de la map d'origine — capturé au chargement du
 *  module, avant toute mutation. Toutes les éditions se calculent depuis lui
 *  (idempotence : réappliquer des éditions ne dérive jamais). */
export const ORIGINAL_BASE_BOXES: readonly MapBox[] = (MAP_COLLIDERS as MapBox[]).map((b) => ({
  ...b,
  min: { ...b.min },
  max: { ...b.max },
}));

/** Liste des boîtes de base APRÈS éditions (suppressions/déplacements).
 *  Chaque entrée conserve kind/color/tex pour le rendu. userData `srcIdx`
 *  (index d'origine) est porté à part par l'appelant si besoin. */
export function editedBaseBoxes(edits: MapBaseEdit[]): MapBox[] {
  const byIdx = new Map<number, MapBaseEdit>();
  for (const e of edits) byIdx.set(e.idx, e);
  const out: MapBox[] = [];
  for (let i = 0; i < ORIGINAL_BASE_BOXES.length; i++) {
    const e = byIdx.get(i);
    if (e?.remove) continue;
    const orig = ORIGINAL_BASE_BOXES[i];
    if (e?.box) {
      const [x0, y0, z0, x1, y1, z1] = e.box;
      out.push({ ...orig, min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
    } else {
      out.push({ ...orig, min: { ...orig.min }, max: { ...orig.max } });
    }
  }
  return out;
}

/** Index d'origine des boîtes retournées par editedBaseBoxes (même ordre). */
export function editedBaseIndices(edits: MapBaseEdit[]): number[] {
  const byIdx = new Map<number, MapBaseEdit>();
  for (const e of edits) byIdx.set(e.idx, e);
  const out: number[] = [];
  for (let i = 0; i < ORIGINAL_BASE_BOXES.length; i++) {
    if (!byIdx.get(i)?.remove) out.push(i);
  }
  return out;
}

/** Sanitise des éditions de base brutes (fichier / réseau) : idx valide,
 *  boîte finie et cohérente, bornes raisonnables. Dédoublonne (dernier gagne). */
export function sanitizeBaseEdits(raw: unknown): MapBaseEdit[] {
  if (!Array.isArray(raw)) return [];
  const byIdx = new Map<number, MapBaseEdit>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    const idx = typeof e.idx === 'number' ? Math.round(e.idx) : -1;
    if (idx < 0 || idx >= ORIGINAL_BASE_BOXES.length) continue;
    if (e.remove === true) {
      byIdx.set(idx, { idx, remove: true });
      continue;
    }
    const b = e.box;
    if (!Array.isArray(b) || b.length !== 6 || !b.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      continue;
    }
    const [x0, y0, z0, x1, y1, z1] = b as number[];
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) continue;
    if (x1 - x0 > 80 || y1 - y0 > 40 || z1 - z0 > 110) continue;
    if (x0 < MAP_BOUNDS.minX - 6 || x1 > MAP_BOUNDS.maxX + 6) continue;
    if (z0 < MAP_BOUNDS.minZ - 6 || z1 > MAP_BOUNDS.maxZ + 6) continue;
    if (y0 < -3 || y1 > 40) continue;
    const r = (n: number): number => Math.round(n * 100) / 100;
    byIdx.set(idx, { idx, box: [r(x0), r(y0), r(z0), r(x1), r(y1), r(z1)] });
  }
  return [...byIdx.values()].sort((a, b) => a.idx - b.idx);
}

/** État complet d'édition de map (persisté / diffusé / par salon). */
export interface MapState {
  objects: PlacedObject[];
  baseEdits: MapBaseEdit[];
  /** Mods d'armes du salon (armurerie) — absent = armes d'origine. */
  weaponMods?: import('./protocol').WeaponModsConfig;
  /** Loadouts remappés par classe — absent = loadouts d'origine. */
  loadouts?: import('./protocol').ClassLoadouts;
  /** Objets de map custom (props importés) définis par le pack. */
  props?: CustomPropDef[];
  /** Terrain de départ — 'kestrel' (défaut) ou 'flat' (terrain vide). */
  baseTerrain?: BaseTerrain;
  /** Mode de jeu du pack — absent = TDM classique. */
  gameMode?: GameModeConfig;
  /** Taille de la map en POURCENTS (50..200, footprint XZ — les hauteurs ne
   *  changent pas). Absent/100 = taille d'origine. */
  mapScale?: number;
}

/** Bornes de l'échelle de map (%). */
export const MAP_SCALE_MIN = 50;
export const MAP_SCALE_MAX = 200;

/** Sanitise l'échelle de map : entier borné, 100 -> undefined (défaut). */
export function sanitizeMapScale(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const v = Math.round(Math.min(MAP_SCALE_MAX, Math.max(MAP_SCALE_MIN, raw)));
  return v === 100 ? undefined : v;
}

/** Facteur d'échelle XZ effectif d'un état (1 = taille d'origine). */
export function mapScaleFactor(state: Pick<MapState, 'mapScale'>): number {
  const v = state.mapScale;
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(MAP_SCALE_MAX, Math.max(MAP_SCALE_MIN, v)) / 100
    : 1;
}

// ----------------------------------------------------------------------------
// Mode de jeu : bornes + sanitisation
// ----------------------------------------------------------------------------

/** Bornes [min, max] des réglages de mode (anti-abus). */
export const MODE_LIMITS = {
  scoreTarget: [10, 1000] as [number, number],
  matchDurationS: [60, 1800] as [number, number],
  captureTimeS: [2, 60] as [number, number],
  pointsPerSecond: [1, 10] as [number, number],
  roundTimeS: [30, 300] as [number, number],
  plantTimeS: [1, 10] as [number, number],
  defuseTimeS: [1, 15] as [number, number],
  bombTimeS: [10, 120] as [number, number],
  roundsToWin: [1, 15] as [number, number],
};

/** Valeurs par défaut d'un mode (appliquées quand un réglage est absent). */
export const MODE_DEFAULTS: Required<Omit<GameModeConfig, 'type'>> = {
  scoreTarget: 75,       // tdm ; l'éditeur propose 200 en dom
  matchDurationS: 600,
  captureTimeS: 10,
  pointsPerSecond: 1,
  roundTimeS: 105,
  plantTimeS: 4,
  defuseTimeS: 6,
  bombTimeS: 40,
  roundsToWin: 4,
};

/** Nombre max de zones exploitées par le serveur. */
export const MAX_CAPTURE_ZONES = 8;
export const MAX_BOMB_SITES = 2;

/** Sanitise la config de mode d'un pack (fichier / réseau). undefined = TDM
 *  classique. Chaque réglage présent est borné ; les absents restent absents
 *  (les défauts s'appliquent à l'exécution). */
export function sanitizeGameMode(raw: unknown): GameModeConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.type !== 'tdm' && r.type !== 'dom' && r.type !== 'sad') return undefined;
  const out: GameModeConfig = { type: r.type };
  for (const key of Object.keys(MODE_LIMITS) as (keyof typeof MODE_LIMITS)[]) {
    const v = r[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [min, max] = MODE_LIMITS[key];
    out[key] = Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
  }
  return out;
}

/** Réglage effectif d'un mode (valeur du pack bornée, sinon défaut). */
export function modeSetting<K extends keyof typeof MODE_DEFAULTS>(
  mode: GameModeConfig | undefined,
  key: K,
): number {
  const v = mode?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : MODE_DEFAULTS[key];
}

/** Nombre max de props custom par pack. */
export const MAX_CUSTOM_PROPS = 24;

const PROP_MODEL_RE = /^\/mods\/models\/[a-z0-9]{8,64}\.(glb|gltf|fbx|obj|stl)$/;
const PROP_TEXTURE_RE = /^\/mods\/textures\/[a-z0-9]{8,64}\.(png|jpg|webp)$/;

/** Sanitise les définitions de props d'un pack (fichier / réseau). */
export function sanitizeProps(raw: unknown): CustomPropDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomPropDef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_CUSTOM_PROPS) break;
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== 'string' || !/^p\d{1,3}$/.test(p.id) || seen.has(p.id)) continue;
    if (typeof p.file !== 'string' || !PROP_MODEL_RE.test(p.file)) continue;
    const label =
      typeof p.label === 'string'
        ? p.label.trim().replace(/[^\p{L}\p{N} _\-'.]/gu, '').slice(0, 20)
        : '';
    const num = (v: unknown, min: number, max: number): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v)) * 100) / 100 : null;
    const rotY = num(p.rotY, -6.3, 6.3);
    const height = num(p.height, 0.1, 20);
    const sizeX = num(p.sizeX, 0.05, 40);
    const sizeY = num(p.sizeY, 0.05, 40);
    const sizeZ = num(p.sizeZ, 0.05, 40);
    if (rotY === null || height === null || sizeX === null || sizeY === null || sizeZ === null) continue;
    const def: CustomPropDef = {
      id: p.id,
      label: label.length > 0 ? label : p.id.toUpperCase(),
      file: p.file,
      rotY,
      height,
      sizeX,
      sizeY,
      sizeZ,
    };
    if (typeof p.map === 'string' && PROP_TEXTURE_RE.test(p.map)) def.map = p.map;
    if (typeof p.normalMap === 'string' && PROP_TEXTURE_RE.test(p.normalMap)) def.normalMap = p.normalMap;
    seen.add(def.id);
    out.push(def);
  }
  return out;
}

/** Murs d'enceinte du TERRAIN VIDE (béton, 4 m) — remplacent toute la map de
 *  base en mode 'flat' ; rendus par le pipeline des boîtes (MapBox). */
export const FLAT_WALLS: readonly MapBox[] = [
  { ...aabbFromBase((MAP_BOUNDS.minX + MAP_BOUNDS.maxX) / 2, 0, MAP_BOUNDS.minZ - 0.3, MAP_BOUNDS.maxX - MAP_BOUNDS.minX + 1.2, 4, 0.6), kind: 'wall', color: '#9aa4ac', tex: 'concrete', uvScale: 4 },
  { ...aabbFromBase((MAP_BOUNDS.minX + MAP_BOUNDS.maxX) / 2, 0, MAP_BOUNDS.maxZ + 0.3, MAP_BOUNDS.maxX - MAP_BOUNDS.minX + 1.2, 4, 0.6), kind: 'wall', color: '#9aa4ac', tex: 'concrete', uvScale: 4 },
  { ...aabbFromBase(MAP_BOUNDS.minX - 0.3, 0, (MAP_BOUNDS.minZ + MAP_BOUNDS.maxZ) / 2, 0.6, 4, MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ + 1.2), kind: 'wall', color: '#9aa4ac', tex: 'concrete', uvScale: 4 },
  { ...aabbFromBase(MAP_BOUNDS.maxX + 0.3, 0, (MAP_BOUNDS.minZ + MAP_BOUNDS.maxZ) / 2, 0.6, 4, MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ + 1.2), kind: 'wall', color: '#9aa4ac', tex: 'concrete', uvScale: 4 },
];

/** Boîtes de base EFFECTIVES d'un état : map de base éditée (ou murs
 *  d'enceinte seuls en terrain vide), à l'ÉCHELLE du pack (mapScale % —
 *  footprint XZ uniquement, les hauteurs ne bougent pas). */
export function effectiveBaseBoxes(state: Pick<MapState, 'baseEdits' | 'baseTerrain' | 'mapScale'>): MapBox[] {
  const boxes =
    state.baseTerrain === 'flat'
      ? FLAT_WALLS.map((b) => ({ ...b, min: { ...b.min }, max: { ...b.max } }))
      : editedBaseBoxes(state.baseEdits);
  const f = mapScaleFactor(state);
  if (f === 1) return boxes;
  for (const b of boxes) {
    b.min.x *= f;
    b.max.x *= f;
    b.min.z *= f;
    b.max.z *= f;
  }
  return boxes;
}

/** Construit un NOUVEAU tableau de colliders pour un état d'édition COMPLET
 *  (terrain + base éditée + objets placés, props compris). Pur — utilisé par
 *  chaque salon serveur (colliders indépendants par room). */
export function buildColliders(state: MapState): AABB[] {
  const out: AABB[] = [];
  for (const b of effectiveBaseBoxes(state)) out.push(b);
  for (const o of state.objects) {
    if (isZoneKind(o.kind)) continue; // zones de mode : jamais solides
    const box = placedObjectAABB(o, state.props);
    if (box) out.push(box);
  }
  return out;
}

/**
 * CLIENT UNIQUEMENT : applique l'état d'édition aux collisions partagées par
 * mutation EN PLACE du tableau MAP_COLLIDERS (le client ne vit que dans un
 * salon à la fois — sim de prédiction, raycasts de tir et fx le référencent).
 */
/** Runtime CLIENT (mono-salon) : facteur d'échelle courant, lu par la
 *  prédiction pour le clamp du monde (identique au serveur — même pack). */
export const CLIENT_RUNTIME = { mapScale: 1 };

export function applyMapState(state: MapState): void {
  const colliders = MAP_COLLIDERS as AABB[];
  colliders.length = 0;
  for (const b of buildColliders(state)) colliders.push(b);
  CLIENT_RUNTIME.mapScale = mapScaleFactor(state);
}
