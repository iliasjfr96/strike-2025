// ============================================================================
// STRIKE 2025 — WeaponModels.ts
// Charge et normalise les VRAIS modèles d'armes GLB (public/weapons/).
// L'orientation de chaque modèle est EXPLICITE (mesurée par inspection des
// fichiers — axe du canon et sens de la bouche varient d'un export à l'autre) :
//   ar-akm.glb      : canon sur X, bouche -X  -> rotY -90°
//   smg-ump.glb     : canon sur X, bouche +X  -> rotY +90°
//   pistol-9mm.glb  : canon sur X, bouche -X  -> rotY -90°
//   sniper-m21.glb  : canon sur Z, bouche -Z  -> aucune rotation
// Après normalisation : canon -> -Z, haut -> +Y, centre bbox à l'origine,
// échelle réelle (m). Repères de visée (ADS) et de bouche (muzzle) calibrés,
// nœuds animables (Magazine, Bolt, Slide, Charging_Handle) pour le reload.
// Crédits (CC-BY 3.0 / CC0) : voir CREDITS.md.
// ============================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WeaponId, WeaponModsConfig } from '../../shared/protocol';

export interface NormalizedWeapon {
  /** Groupe racine orienté (canon vers -Z, haut vers +Y), à l'échelle réelle. */
  root: THREE.Group;
  /** Repère au bout du canon (monde du viewmodel). */
  muzzle: THREE.Object3D;
  /** Hauteur de la ligne de visée (rail/lunette) — alignement ADS. */
  adsY: number;
  /** Longueur totale (m). */
  length: number;
  /** Nœuds animables si présents. */
  mag: THREE.Object3D | null;
  bolt: THREE.Object3D | null;
}

interface WeaponDef {
  file: string;
  /** Longueur réelle cible (m). */
  realLength: number;
  /** Rotation Y (rad) amenant le canon sur -Z (mesurée par inspection du GLB). */
  rotY: number;
  /** Hauteur de la ligne de visée au-dessus du centre bbox (m, échelle finale). */
  adsY: number;
  /** Hauteur de la bouche du canon au-dessus du centre bbox (m, échelle finale). */
  muzzleY: number;
  /** Texture couleur custom (remplace les matériaux du modèle). */
  map?: string;
  /** Texture normale custom (relief). */
  normalMap?: string;
}

// adsY/muzzleY dérivés des bbox mesurées des GLB (ligne de mire ≈ sommet de la
// carcasse ; lunette du M21 : axe optique mesuré à +0.075 m du centre).
const DEFS: Record<WeaponId, WeaponDef> = {
  vsk27: { file: './weapons/ar-akm.glb', realLength: 0.88, rotY: -Math.PI / 2, adsY: 0.118, muzzleY: 0.02 },
  kv9: { file: './weapons/smg-ump.glb', realLength: 0.69, rotY: Math.PI / 2, adsY: 0.152, muzzleY: 0.025 },
  lr50: { file: './weapons/sniper-m21.glb', realLength: 1.12, rotY: 0, adsY: 0.075, muzzleY: 0.012 },
  p9: { file: './weapons/pistol-9mm.glb', realLength: 0.21, rotY: -Math.PI / 2, adsY: 0.074, muzzleY: 0.045 },
  // Emplacements custom : modèle AR par défaut tant que le pack n'en fournit pas.
  custom1: { file: './weapons/ar-akm.glb', realLength: 0.88, rotY: -Math.PI / 2, adsY: 0.118, muzzleY: 0.02 },
  custom2: { file: './weapons/ar-akm.glb', realLength: 0.88, rotY: -Math.PI / 2, adsY: 0.118, muzzleY: 0.02 },
  custom3: { file: './weapons/ar-akm.glb', realLength: 0.88, rotY: -Math.PI / 2, adsY: 0.118, muzzleY: 0.02 },
};

const loader = new GLTFLoader();
const cache = new Map<WeaponId, NormalizedWeapon | null>();
const pending = new Map<WeaponId, Promise<NormalizedWeapon | null>>();

/** Modèles custom du salon courant (armurerie) : remplacent DEFS par arme. */
const modelOverrides = new Map<WeaponId, WeaponDef>();

/**
 * Applique les modèles custom du salon (mods d'armurerie). Purge le cache des
 * armes concernées — les prochains chargements utilisent le GLB uploadé avec
 * sa calibration. Retourne les ids dont le modèle a changé.
 */
export function setWeaponModelMods(mods: WeaponModsConfig): WeaponId[] {
  const changed: WeaponId[] = [];
  for (const id of Object.keys(DEFS) as WeaponId[]) {
    const model = mods[id]?.model;
    const prev = modelOverrides.get(id);
    if (model) {
      if (
        prev?.file === model.file &&
        prev.rotY === model.rotY &&
        prev.realLength === model.realLength &&
        prev.adsY === model.adsY &&
        prev.muzzleY === model.muzzleY &&
        prev.map === model.map &&
        prev.normalMap === model.normalMap
      ) {
        continue; // identique — cache conservé
      }
      modelOverrides.set(id, {
        file: model.file,
        realLength: model.realLength,
        rotY: model.rotY,
        adsY: model.adsY,
        muzzleY: model.muzzleY,
        map: model.map,
        normalMap: model.normalMap,
      });
      changed.push(id);
    } else if (prev) {
      modelOverrides.delete(id);
      changed.push(id);
    } else {
      continue;
    }
    cache.delete(id);
    pending.delete(id);
  }
  return changed;
}

/** Normalise un GLB chargé : orientation EXPLICITE canon -> -Z, échelle, repères. */
function normalize(gltfScene: THREE.Group, def: WeaponDef): NormalizedWeapon {
  const inner = new THREE.Group();
  inner.add(gltfScene);

  // 1. Orientation explicite (vérité terrain de chaque GLB — voir DEFS).
  gltfScene.rotation.y = def.rotY;
  gltfScene.updateMatrixWorld(true);

  // 2. Échelle réelle sur l'axe canon (Z après rotation) + recentrage.
  const box2 = new THREE.Box3().setFromObject(gltfScene);
  const size2 = box2.getSize(new THREE.Vector3());
  // Garde-fou : après rotation, Z doit être la dimension la plus longue.
  if (size2.z < Math.max(size2.x, size2.y)) {
    console.warn(
      `[weapons] ${def.file} : l'axe canon ne domine pas après rotation ` +
        `(${size2.x.toFixed(2)} × ${size2.y.toFixed(2)} × ${size2.z.toFixed(2)}) — vérifier rotY`,
    );
  }
  const scale = def.realLength / Math.max(size2.z, 0.001);
  inner.scale.setScalar(scale);
  const center2 = box2.getCenter(new THREE.Vector3());
  gltfScene.position.sub(center2);

  const root = new THREE.Group();
  root.add(inner);
  root.updateMatrixWorld(true);

  // 3. Repères calibrés : bouche du canon (avant -Z) + ligne de visée.
  const box3 = new THREE.Box3().setFromObject(root);
  const muzzle = new THREE.Object3D();
  muzzle.name = '__muzzle__';
  muzzle.position.set(0, def.muzzleY, box3.min.z + 0.01);
  root.add(muzzle);
  const adsY = def.adsY;

  // 4. Nœuds animables (pose de repos mémorisée pour reload + bake distants).
  let mag: THREE.Object3D | null = null;
  let bolt: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (mag === null && /^magazine(?!_release)/i.test(o.name)) mag = o;
    if (bolt === null && /^(bolt|slide|charging_handle)$/i.test(o.name)) bolt = o;
  });
  if (mag !== null) (mag as THREE.Object3D).userData.y0 = (mag as THREE.Object3D).position.y;
  if (bolt !== null) (bolt as THREE.Object3D).userData.z0 = (bolt as THREE.Object3D).position.z;

  // 5. Rendu : ombres off, toujours visible, matériaux ajustés.
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;
      const mat = o.material as THREE.MeshStandardMaterial;
      if (mat && 'envMapIntensity' in mat) {
        mat.envMapIntensity = 0.75;
        if (mat.metalness !== undefined && mat.metalness < 0.3) mat.metalness = 0.35;
        mat.needsUpdate = true;
      }
    }
  });

  return { root, muzzle, adsY, length: def.realLength, mag, bolt };
}

/** Matériau par défaut pour les formats sans matériaux (OBJ/STL). */
function defaultModMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#8f979f',
    roughness: 0.55,
    metalness: 0.55,
    envMapIntensity: 0.7,
  });
}

/**
 * Charge une scène 3D selon le FORMAT de l'URL : GLB/GLTF (GLTFLoader),
 * FBX, OBJ (matériau par défaut), STL (géométrie seule -> mesh gris).
 * Les loaders spécialisés sont importés à la demande (bundle principal léger).
 */
export async function loadSceneByUrl(url: string): Promise<THREE.Group> {
  const ext = (url.split('.').pop() ?? 'glb').toLowerCase();
  if (ext === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    return await new FBXLoader().loadAsync(url);
  }
  if (ext === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    const g = await new OBJLoader().loadAsync(url);
    // OBJ sans .mtl : matériau standard homogène (Phong par défaut sinon).
    const mat = defaultModMaterial();
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = mat;
    });
    return g;
  }
  if (ext === 'stl') {
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
    const geom = await new STLLoader().loadAsync(url);
    geom.computeVertexNormals();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geom, defaultModMaterial()));
    return g;
  }
  const gltf = await loader.loadAsync(url); // .glb / .gltf (embarqué)
  return gltf.scene;
}

/** Projection UV boîte (espace objet) pour les géométries SANS coordonnées
 *  UV (STL notamment) : la texture custom reste affichable. */
function boxProjectUV(geom: THREE.BufferGeometry): void {
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const inv = 1 / Math.max(size.x, size.y, size.z, 0.001);
  const pos = geom.getAttribute('position');
  if (!geom.getAttribute('normal')) geom.computeVertexNormals();
  const nor = geom.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = (pos.getX(i) - bb.min.x) * inv;
    const y = (pos.getY(i) - bb.min.y) * inv;
    const z = (pos.getZ(i) - bb.min.z) * inv;
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    } else if (nx >= nz) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Applique les textures custom (albedo / normale) à TOUS les meshes du
 *  modèle — remplace ses matériaux (cas FBX/OBJ/STL sans textures). */
export function applyTextureOverrides(scene: THREE.Group, def: { map?: string; normalMap?: string }): void {
  if (!def.map && !def.normalMap) return;
  const texLoader = new THREE.TextureLoader();
  let map: THREE.Texture | null = null;
  if (def.map) {
    map = texLoader.load(def.map);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    // flipY par défaut (true) : convention des pipelines OBJ/FBX — les cas
    // d'usage de l'override texture (GLB embarqué a déjà les siennes).
  }
  let normalMap: THREE.Texture | null = null;
  if (def.normalMap) {
    normalMap = texLoader.load(def.normalMap);
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
  }
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    color: '#ffffff',
    roughness: 0.55,
    metalness: 0.4,
    envMapIntensity: 0.75,
  });
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (!o.geometry.getAttribute('uv')) boxProjectUV(o.geometry as THREE.BufferGeometry);
      o.material = mat;
    }
  });
}

/** Définition de modèle pour l'APERÇU (armurerie) — mêmes champs que DEFS. */
export type PreviewModelDef = WeaponDef;

/** Définition par défaut d'une arme (pour l'aperçu quand aucun modèle custom
 *  n'est défini). Clone — mutable sans risque. */
export function defaultModelDef(id: WeaponId): PreviewModelDef {
  return { ...DEFS[id] };
}

/**
 * Charge un modèle POUR L'APERÇU : chargement FRAIS (jamais mis en cache,
 * jamais partagé — l'appelant peut tout disposer), textures custom
 * appliquées, normalisation identique au jeu. null en cas d'échec.
 */
export async function buildPreviewModel(def: PreviewModelDef): Promise<NormalizedWeapon | null> {
  try {
    const scene = await loadSceneByUrl(def.file);
    applyTextureOverrides(scene, def);
    return normalize(scene, def);
  } catch (err) {
    console.warn(`[aperçu] échec de chargement ${def.file} :`, err);
    return null;
  }
}

/** Charge (avec cache) le modèle d'une arme. Retourne null en cas d'échec. */
export function loadWeaponModel(id: WeaponId): Promise<NormalizedWeapon | null> {
  const hit = cache.get(id);
  if (hit !== undefined) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    const def = modelOverrides.get(id) ?? DEFS[id];
    p = loadSceneByUrl(def.file)
      .then((scene) => {
        applyTextureOverrides(scene, def);
        const n = normalize(scene, def);
        cache.set(id, n);
        return n;
      })
      .catch((err: unknown) => {
        console.warn(`[weapons] échec de chargement ${def.file} :`, err);
        cache.set(id, null);
        return null;
      });
    pending.set(id, p);
  }
  return p;
}

/** Clone léger (géométrie partagée) pour les instances multiples. */
export function cloneWeapon(n: NormalizedWeapon): NormalizedWeapon {
  const root = n.root.clone(true);
  let muzzle: THREE.Object3D | null = null;
  let mag: THREE.Object3D | null = null;
  let bolt: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (o.name === '__muzzle__') muzzle = o;
    if (n.mag && o.name === n.mag.name && mag === null) mag = o;
    if (n.bolt && o.name === n.bolt.name && bolt === null) bolt = o;
  });
  return {
    root,
    muzzle: muzzle ?? n.muzzle,
    adsY: n.adsY,
    length: n.length,
    mag,
    bolt,
  };
}

/** Cache des fusions par arme : géométries/matériaux PARTAGÉS entre tous les
 *  avatars distants — un switch d'arme ajoute des Mesh légers, sans re-merge
 *  ni fuite de géométrie. */
const mergedCache = new WeakMap<
  NormalizedWeapon,
  { entries: { geom: THREE.BufferGeometry; mat: THREE.Material }[]; muzzlePos: THREE.Vector3 }
>();

/**
 * Version FUSIONNÉE d'une arme pour les joueurs distants : les meshes du
 * modèle sont regroupés par matériau en 1-3 meshes (ex. M21 : 82 nœuds ->
 * 2-3 draw calls au lieu de 82 par joueur). Crucial pour le FPS à 16 joueurs.
 * Le résultat (géométries + matériaux) est mis en cache et PARTAGÉ : chaque
 * appel retourne un groupe de Mesh légers pointant sur les mêmes données.
 */
export function mergedWeapon(n: NormalizedWeapon): { root: THREE.Group; muzzle: THREE.Object3D } {
  let cached = mergedCache.get(n);
  if (!cached) {
    // L'instance source est PARTAGÉE avec le viewmodel : remet les nœuds
    // animables à leur pose de REPOS avant le bake (un reload en cours ne
    // doit pas être cuit dans l'arme des joueurs distants).
    if (n.bolt && typeof n.bolt.userData.z0 === 'number') {
      n.bolt.position.z = n.bolt.userData.z0 as number;
    }
    const magWasVisible = n.mag ? n.mag.visible : true;
    if (n.mag) n.mag.visible = true;
    n.root.updateMatrixWorld(true);
    // Bake en ESPACE ROOT (matrice du root inversée) : si l'arme est en ce
    // moment le viewmodel actif, son matrixWorld inclut la chaîne
    // group->caméra — sans cette inversion la géométrie des joueurs distants
    // serait bakée avec la pose caméra du moment. Mains procédurales exclues.
    const rootInv = new THREE.Matrix4().copy(n.root.matrixWorld).invert();
    const local = new THREE.Matrix4();
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    n.root.traverse((o) => {
      if (o.userData.isHand) return;
      if (o instanceof THREE.Mesh && o.geometry) {
        const geom = o.geometry.clone();
        geom.applyMatrix4(local.multiplyMatrices(rootInv, o.matrixWorld));
        // Supprime les attributs inutiles au merge (groupes, skinning).
        for (const name of Object.keys(geom.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) geom.deleteAttribute(name);
        }
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const key = mats[0] as THREE.Material;
        let list = byMaterial.get(key);
        if (!list) {
          list = [];
          byMaterial.set(key, list);
        }
        list.push(geom);
      }
    });
    const entries: { geom: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    for (const [mat, geoms] of byMaterial) {
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) continue;
      entries.push({ geom: merged, mat });
    }
    if (n.mag) n.mag.visible = magWasVisible;
    cached = { entries, muzzlePos: n.muzzle.position.clone() };
    mergedCache.set(n, cached);
  }

  const inner = new THREE.Group();
  for (const { geom, mat } of cached.entries) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.userData.sharedGeom = true; // ne JAMAIS disposer (cache partagé)
    inner.add(mesh);
  }
  // Même échelle/orientation que l'original.
  const root = new THREE.Group();
  root.add(inner);
  const muzzle = new THREE.Object3D();
  muzzle.name = '__muzzle__';
  muzzle.position.copy(cached.muzzlePos);
  root.add(muzzle);
  return { root, muzzle };
}
