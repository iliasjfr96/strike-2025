// ============================================================================
// STRIKE 2025 — server/CustomMap.ts
// Persistance de l'état d'édition du SALON PRINCIPAL (l'éditeur de map cible
// toujours « main ») : data/map-objects.json. Chargement au démarrage,
// sauvegarde atomique. Les COLLISIONS ne sont plus appliquées ici : chaque
// Game (salon) possède désormais ses propres colliders — voir Game.applyMap.
// Les éditions de base sont invalidées si MAP_VERSION change.
// ============================================================================

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAP_VERSION } from '../src/shared/map.js';
import type { MapState } from '../src/shared/mapObjects.js';
import { sanitizeBaseEdits, sanitizePlacedObjects, sanitizeProps } from '../src/shared/mapObjects.js';
import { sanitizeLoadouts, sanitizeWeaponMods } from '../src/shared/weaponMods.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'map-objects.json');

/** Charge l'état d'édition du salon principal depuis le disque. */
export function loadMainMapState(): MapState {
  try {
    if (existsSync(DATA_FILE)) {
      const raw: unknown = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
      const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
      const props = sanitizeProps(data.props);
      const objects = sanitizePlacedObjects('objects' in data ? data.objects : raw, props);
      const baseTerrain = data.baseTerrain === 'flat' ? 'flat' as const : 'kestrel' as const;
      const weaponMods = sanitizeWeaponMods(data.weaponMods);
      const loadouts = sanitizeLoadouts(data.loadouts);
      let baseEdits = data.mapVersion === MAP_VERSION ? sanitizeBaseEdits(data.baseEdits) : [];
      if (baseEdits.length === 0 && Array.isArray(data.baseEdits) && data.baseEdits.length > 0 && data.mapVersion !== MAP_VERSION) {
        console.warn(
          `[map] éditions de base ignorées : map v${String(data.mapVersion)} != v${MAP_VERSION} (les index ne correspondent plus)`,
        );
        baseEdits = [];
      }
      console.log(
        `[map] édition du salon principal chargée : ${objects.length} objet(s), ${baseEdits.length} édition(s) de base`,
      );
      return { objects, baseEdits, weaponMods, loadouts, props, baseTerrain };
    }
  } catch (err) {
    console.error('[map] échec de chargement de l’édition de map :', err);
  }
  return { objects: [], baseEdits: [], weaponMods: {}, loadouts: {}, props: [], baseTerrain: 'kestrel' };
}

/** Sanitise et persiste (écriture atomique) l'état du salon principal. */
export function saveMainMapState(rawObjects: unknown, rawBaseEdits: unknown, rawWeaponMods?: unknown, rawLoadouts?: unknown, rawProps?: unknown, rawTerrain?: unknown): MapState {
  const props = sanitizeProps(rawProps);
  const state: MapState = {
    objects: sanitizePlacedObjects(rawObjects, props),
    baseEdits: sanitizeBaseEdits(rawBaseEdits),
    weaponMods: sanitizeWeaponMods(rawWeaponMods),
    loadouts: sanitizeLoadouts(rawLoadouts),
    props,
    baseTerrain: rawTerrain === 'flat' ? 'flat' : 'kestrel',
  };
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    writeFileSync(
      tmp,
      JSON.stringify(
        { version: 2, mapVersion: MAP_VERSION, objects: state.objects, baseEdits: state.baseEdits, weaponMods: state.weaponMods, loadouts: state.loadouts, props: state.props, baseTerrain: state.baseTerrain },
        null,
        1,
      ),
      'utf8',
    );
    renameSync(tmp, DATA_FILE);
    console.log(
      `[map] édition sauvegardée : ${state.objects.length} objet(s), ${state.baseEdits.length} édition(s) de base`,
    );
  } catch (err) {
    console.error('[map] échec de sauvegarde de l’édition de map :', err);
  }
  return state;
}
