// ============================================================================
// STRIKE 2025 — PropModels.ts
// Objets de map custom (props importés par les packs) : chargement multi-
// format (via WeaponModels.loadSceneByUrl), textures custom, normalisation
// par HAUTEUR réelle (rotY appliqué, base posée à y=0, centré en X/Z),
// cache de templates par définition et instances par clonage léger.
// Les dimensions de la bbox normalisée servent aussi à l'éditeur pour
// renseigner la boîte de collision du prop (stockée dans le pack).
// ============================================================================

import * as THREE from 'three';
import type { CustomPropDef } from '../../shared/protocol';
import { applyTextureOverrides, loadSceneByUrl } from './WeaponModels';

export interface PropTemplate {
  /** Racine normalisée : base à y=0, centrée en X/Z, hauteur = def.height. */
  root: THREE.Group;
  /** Dimensions de la bbox normalisée (m) — boîte de collision naturelle. */
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

const cache = new Map<string, Promise<PropTemplate | null>>();

function keyOf(def: Pick<CustomPropDef, 'file' | 'map' | 'normalMap' | 'rotY' | 'height'>): string {
  return `${def.file}|${def.map ?? ''}|${def.normalMap ?? ''}|${def.rotY}|${def.height}`;
}

/** Charge (avec cache) le template normalisé d'un prop. null si échec. */
export function loadPropTemplate(
  def: Pick<CustomPropDef, 'file' | 'map' | 'normalMap' | 'rotY' | 'height'>,
): Promise<PropTemplate | null> {
  const key = keyOf(def);
  let p = cache.get(key);
  if (!p) {
    p = buildPropTemplate(def);
    cache.set(key, p);
  }
  return p;
}

/** Construit un template FRAIS (sans cache) — utilisé aussi par l'aperçu. */
export async function buildPropTemplate(
  def: Pick<CustomPropDef, 'file' | 'map' | 'normalMap' | 'rotY' | 'height'>,
): Promise<PropTemplate | null> {
  try {
    const scene = await loadSceneByUrl(def.file);
    applyTextureOverrides(scene, def);
    const inner = new THREE.Group();
    inner.add(scene);
    // 1. Orientation.
    scene.rotation.y = def.rotY;
    scene.updateMatrixWorld(true);
    // 2. Échelle uniforme : hauteur bbox -> def.height.
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = def.height / Math.max(size.y, 0.001);
    inner.scale.setScalar(scale);
    // 3. Base posée à y=0, centre en X/Z.
    const center = box.getCenter(new THREE.Vector3());
    scene.position.set(-center.x, -box.min.y, -center.z);
    const root = new THREE.Group();
    root.add(inner);
    root.updateMatrixWorld(true);
    // 4. Rendu : ombres + dimensions finales.
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const finalBox = new THREE.Box3().setFromObject(root);
    const finalSize = finalBox.getSize(new THREE.Vector3());
    return {
      root,
      sizeX: Math.round(finalSize.x * 100) / 100,
      sizeY: Math.round(finalSize.y * 100) / 100,
      sizeZ: Math.round(finalSize.z * 100) / 100,
    };
  } catch (err) {
    console.warn(`[props] échec de chargement ${def.file} :`, err);
    return null;
  }
}

/** Instance d'un template (clonage — géométries/matériaux PARTAGÉS : ne
 *  jamais disposer les instances, seulement les retirer de la scène). */
export function instantiateProp(template: PropTemplate): THREE.Group {
  const clone = template.root.clone(true);
  clone.traverse((o) => {
    o.userData.sharedGeom = true; // protégé des dispose des avatars/objets
  });
  return clone;
}
