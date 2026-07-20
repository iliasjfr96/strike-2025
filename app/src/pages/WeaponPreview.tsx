// ============================================================================
// STRIKE 2025 — WeaponPreview.tsx
// Fenêtre d'APERÇU 3D de l'armurerie : mini-viewport WebGL autonome intégré
// au panneau (renderer dédié, éclairage studio RoomEnvironment). Le modèle
// (custom ou par défaut) est rechargé — débouncé — à chaque changement de
// calibration/texture, tourne lentement, et se laisse orienter à la souris.
// Marqueurs : ligne bleue = ligne de visée (adsY) · sphère ambre = bouche.
// ============================================================================

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPreviewModel } from '../game/render/WeaponModels';
import type { PreviewModelDef } from '../game/render/WeaponModels';
import { buildPropTemplate } from '../game/render/PropModels';

/** Définition d'aperçu d'un PROP (objet de map) — normalisé par hauteur. */
export interface PropPreviewDef {
  file: string;
  rotY: number;
  height: number;
  map?: string;
  normalMap?: string;
}

/** Libère géométries et matériaux d'un sous-arbre (chargement frais). */
function disposeDeep(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose();
    }
  });
}

export default function WeaponPreview({ def, propDef }: { def?: PreviewModelDef; propDef?: PropPreviewDef }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Rotation manuelle (glisser horizontal) ajoutée à la rotation auto. */
  const dragYaw = useRef(0);
  const dragging = useRef(false);
  const lastX = useRef(0);

  // La définition sérialisée sert de clé de rechargement (débouncé).
  const defKey = JSON.stringify(propDef ? { prop: propDef } : { weapon: def });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.clientWidth || 520;
    const height = 230;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1015');
    // Éclairage studio (PBR correct pour les métaux, sans lumières manuelles).
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 20);
    const pivot = new THREE.Group();
    scene.add(pivot);

    let disposed = false;
    let weaponRoot: THREE.Object3D | null = null;

    // Chargement débouncé du modèle avec la calibration courante.
    const parsed = JSON.parse(defKey) as { weapon?: PreviewModelDef; prop?: PropPreviewDef };
    const timer = window.setTimeout(() => {
      const install = (group: THREE.Group, frameSize: number, lookY: number): void => {
        if (weaponRoot) {
          pivot.remove(weaponRoot);
          disposeDeep(weaponRoot);
          weaponRoot = null;
        }
        pivot.add(group);
        weaponRoot = group;
        const d = Math.max(0.5, frameSize * 1.15);
        camera.position.set(d * 0.75, d * 0.35, d * 0.85);
        camera.lookAt(0, lookY, 0);
      };
      if (parsed.prop) {
        // Mode PROP : normalisé par hauteur, base à y=0 — pas de marqueurs.
        void buildPropTemplate(parsed.prop).then((tpl) => {
          if (disposed) {
            if (tpl) disposeDeep(tpl.root);
            return;
          }
          if (!tpl) return;
          const group = new THREE.Group();
          group.add(tpl.root);
          install(group, Math.max(tpl.sizeX, tpl.sizeY, tpl.sizeZ), tpl.sizeY * 0.45);
        });
        return;
      }
      void buildPreviewModel(parsed.weapon as PreviewModelDef).then((n) => {
        if (disposed) {
          if (n) disposeDeep(n.root);
          return;
        }
        if (!n) return;
        const group = new THREE.Group();
        group.add(n.root);
        // Ligne de visée (bleue) au niveau adsY, le long du canon (-Z).
        const sight = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, n.adsY, n.length * 0.55),
            new THREE.Vector3(0, n.adsY, -n.length * 0.8),
          ]),
          new THREE.LineBasicMaterial({ color: '#58A6E8' }),
        );
        group.add(sight);
        // Bouche du canon (sphère ambre).
        const muzzle = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(0.012, n.length * 0.018), 10, 10),
          new THREE.MeshBasicMaterial({ color: '#F59E1F' }),
        );
        muzzle.position.copy(n.muzzle.position);
        group.add(muzzle);
        install(group, n.length, n.adsY * 0.5);
      });
    }, 250);

    // Boucle : rotation auto + rotation manuelle.
    let raf = 0;
    const loop = (): void => {
      raf = requestAnimationFrame(loop);
      pivot.rotation.y = dragYaw.current + performance.now() * 0.00035;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      if (weaponRoot) disposeDeep(weaponRoot);
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, [defKey]);

  return (
    <div className="mt-2">
      <canvas
        ref={canvasRef}
        className="chamfer-6 block w-full cursor-grab border border-line active:cursor-grabbing"
        style={{ height: 230 }}
        onPointerDown={(e) => {
          dragging.current = true;
          lastX.current = e.clientX;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          dragYaw.current += (e.clientX - lastX.current) * 0.01;
          lastX.current = e.clientX;
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      />
      <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-text-dim">
        {propDef
          ? 'Aperçu live — glissez pour tourner · la hauteur définit l’échelle réelle'
          : 'Aperçu live — glissez pour tourner · ligne bleue = ligne de visée · sphère ambre = bouche du canon'}
      </p>
    </div>
  );
}
