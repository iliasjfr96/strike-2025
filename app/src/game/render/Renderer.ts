// ============================================================================
// STRIKE 2025 — Renderer.ts
// Scène three + WebGLRenderer : skybox équirectangulaire (public/sky-dusk.png)
// utilisée en background ET en environment (IBL), ACES tone mapping, brouillard
// accordé à l'horizon. Perf : pixelRatio capé par qualité, auto-qualité
// (dégradation si fps bas), compteur FPS discret (toggle F3).
// ============================================================================

import * as THREE from 'three';
import type { QualityLevel } from '../../ui/store';

/** Direction du soleil (normalisée) — jour couvert, lumière diffuse haute. */
const SUN_DIR = new THREE.Vector3(-0.45, 0.75, -0.35).normalize();

/** Layer du viewmodel (arme 1re personne) : rendu par une passe dédiée à FOV
 *  fixe — le zoom ADS ne grossit jamais l'arme et elle ne clippe pas les murs. */
export const VIEWMODEL_LAYER = 1;
/** FOV (degrés) de la caméra viewmodel — constant, indépendant du FOV monde. */
const VIEWMODEL_FOV = 50;

function pixelRatioFor(q: QualityLevel): number {
  const dpr = window.devicePixelRatio || 1;
  switch (q) {
    case 'low':
      return 1;
    case 'medium':
      return Math.min(dpr, 1.25);
    case 'high':
      return Math.min(dpr, 1.5);
    case 'ultra':
      return Math.min(dpr, 2);
  }
}

const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export class Renderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Caméra dédiée au viewmodel (FOV fixe, passe séparée avec clearDepth). */
  readonly viewmodelCamera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly sun: THREE.DirectionalLight;
  private quality: QualityLevel;
  /** Qualité effectif (auto-dégradation) — peut différer du réglage demandé. */
  private effectiveQuality: QualityLevel;
  /** FOV de base (degrés) depuis settings ; le zoom ADS est appliqué par frame. */
  baseFov: number;
  private currentFov: number;
  private readonly onResize = (): void => this.resize();

  // ---- Compteur FPS / auto-qualité ------------------------------------------
  private fpsEl: HTMLDivElement | null = null;
  private fpsVisible = false;
  private frameCount = 0;
  private fpsAccum = 0;
  private fpsValue = 0;
  private lowFpsSince = 0;
  private highFpsSince = 0;
  private lastFrameAt = 0;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3') {
      e.preventDefault();
      this.toggleFps();
    }
  };

  constructor(canvas: HTMLCanvasElement, quality: QualityLevel, baseFov: number) {
    this.canvas = canvas;
    this.quality = quality;
    this.effectiveQuality = quality;
    this.baseFov = baseFov;
    this.currentFov = baseFov;

    this.scene = new THREE.Scene();
    // Brouillard gris industriel accordé au ciel couvert.
    this.scene.fog = new THREE.Fog(new THREE.Color('#5E6870'), 40, 300);

    this.camera = new THREE.PerspectiveCamera(baseFov, 1, 0.05, 700);
    this.camera.rotation.order = 'YXZ';

    // Caméra viewmodel : même pose que la caméra monde (copiée à chaque
    // render), FOV fixe, near court (l'arme est à 15-70 cm), layer dédié.
    this.viewmodelCamera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 1, 0.012, 6);
    this.viewmodelCamera.layers.set(VIEWMODEL_LAYER);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // ---- Skybox équirectangulaire (background + environment IBL) ------------
    const texLoader = new THREE.TextureLoader();
    texLoader.load('./sky-overcast.png', (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = tex;
      this.scene.environment = tex;
      this.scene.backgroundIntensity = 1.0;
      this.scene.environmentIntensity = 0.6;
    });

    // ---- Lumière jour couvert (diffuse, froide, douce) -----------------------
    this.sun = new THREE.DirectionalLight('#C8D2DC', 1.5);
    this.sun.position.copy(SUN_DIR).multiplyScalar(110);
    this.sun.castShadow = quality === 'high' || quality === 'ultra';
    this.sun.shadow.mapSize.set(quality === 'ultra' ? 2048 : 1024, quality === 'ultra' ? 2048 : 1024);
    this.sun.shadow.camera.left = -60;
    this.sun.shadow.camera.right = 60;
    this.sun.shadow.camera.top = 55;
    this.sun.shadow.camera.bottom = -55;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 280;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    // Les lumières globales éclairent AUSSI la passe viewmodel (layer dédié).
    this.sun.layers.enable(VIEWMODEL_LAYER);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Hémisphère gris-bleu (ciel couvert) / gris brun (sol).
    const hemi = new THREE.HemisphereLight('#9FB4C4', '#2A3138', 1.0);
    hemi.layers.enable(VIEWMODEL_LAYER);
    this.scene.add(hemi);

    this.applyQuality(quality);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    this.resize();
  }

  /** Qualité demandée par l'utilisateur (settings). */
  applyQuality(q: QualityLevel): void {
    this.quality = q;
    this.applyEffective(q);
  }

  /** Applique pixelRatio + ombres pour une qualité donnée. */
  private applyEffective(q: QualityLevel): void {
    this.effectiveQuality = q;
    this.renderer.setPixelRatio(pixelRatioFor(q));
    this.sun.castShadow = q === 'high' || q === 'ultra';
    this.resize();
  }

  /** FOV effectif (base × zoom ADS) — n'update la projection que si changé. */
  setFov(fov: number): void {
    if (Math.abs(fov - this.currentFov) < 0.01) return;
    this.currentFov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setBaseFov(fov: number): void {
    this.baseFov = fov;
  }

  /**
   * Reprojette un point monde vu par la caméra VIEWMODEL (FOV fixe) vers le
   * point monde qui s'affiche au MÊME endroit écran pour la caméra principale
   * (FOV zoomable), à la profondeur `depth`. Sert d'origine aux fx monde
   * (tracantes, étuis) pour qu'ils partent visuellement de la bouche du canon.
   */
  viewmodelToWorld(worldPoint: THREE.Vector3, depth: number, out: THREE.Vector3): THREE.Vector3 {
    this.viewmodelCamera.position.copy(this.camera.position);
    this.viewmodelCamera.quaternion.copy(this.camera.quaternion);
    this.viewmodelCamera.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    out.copy(worldPoint).project(this.viewmodelCamera); // -> NDC écran
    out.z = 0.5;
    out.unproject(this.camera); // -> monde (caméra principale)
    out.sub(this.camera.position).normalize().multiplyScalar(depth).add(this.camera.position);
    return out;
  }

  /** Dimensions depuis le conteneur hôte (canvas en CSS 100%). */
  resize(): void {
    const host = this.canvas.parentElement;
    const w = Math.max(1, host ? host.clientWidth : window.innerWidth);
    const h = Math.max(1, host ? host.clientHeight : window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodelCamera.aspect = w / h;
    this.viewmodelCamera.updateProjectionMatrix();
  }

  /** FPS courant (moyenne glissante ~0,5 s). */
  get fps(): number {
    return this.fpsValue;
  }

  /** Affiche/masque le compteur FPS (F3). */
  toggleFps(): void {
    this.fpsVisible = !this.fpsVisible;
    if (this.fpsVisible && this.fpsEl === null) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.style.cssText =
        'position:absolute;left:50%;bottom:6px;transform:translateX(-50%);' +
        'font:12px "Share Tech Mono",monospace;color:#7FA8C9;background:rgba(6,9,12,0.55);' +
        'padding:2px 10px;letter-spacing:0.12em;pointer-events:none;z-index:25;' +
        'border:1px solid rgba(127,168,201,0.25);';
      this.canvas.parentElement?.appendChild(this.fpsEl);
    }
    if (this.fpsEl) this.fpsEl.style.display = this.fpsVisible ? 'block' : 'none';
  }

  render(): void {
    const now = performance.now();
    if (this.lastFrameAt > 0) {
      this.frameCount++;
      this.fpsAccum += now - this.lastFrameAt;
      if (this.fpsAccum >= 500) {
        this.fpsValue = Math.round((this.frameCount * 1000) / this.fpsAccum);
        this.frameCount = 0;
        this.fpsAccum = 0;
        if (this.fpsVisible && this.fpsEl) {
          this.fpsEl.textContent = `${this.fpsValue} FPS · ${this.effectiveQuality.toUpperCase()}`;
        }
        this.autoQuality();
      }
    }
    this.lastFrameAt = now;

    // Passe 1 : monde (layer 0) avec la caméra principale (FOV zoomable ADS).
    this.renderer.render(this.scene, this.camera);

    // Passe 2 : viewmodel (layer dédié) à FOV fixe, par-dessus (clearDepth) —
    // l'arme ne clippe jamais les murs et n'est pas grossie par le zoom ADS.
    // La caméra viewmodel copie la pose MONDE de la caméra principale (le
    // groupe viewmodel est enfant de celle-ci dans le graphe).
    this.viewmodelCamera.position.copy(this.camera.position);
    this.viewmodelCamera.quaternion.copy(this.camera.quaternion);
    this.renderer.clearDepth();
    const prevAutoClear = this.renderer.autoClear;
    const prevShadowAuto = this.renderer.shadowMap.autoUpdate;
    const prevBackground = this.scene.background;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.autoUpdate = false; // ombres déjà rendues en passe 1
    this.scene.background = null; // la skybox ne doit PAS recouvrir la passe 1
    this.renderer.render(this.scene, this.viewmodelCamera);
    this.renderer.autoClear = prevAutoClear;
    this.renderer.shadowMap.autoUpdate = prevShadowAuto;
    this.scene.background = prevBackground;
  }

  /** Dégrade la qualité si fps < 45 (5 s), remonte si > 58 (10 s). */
  private autoQuality(): void {
    const idx = QUALITY_ORDER.indexOf(this.effectiveQuality);
    const userIdx = QUALITY_ORDER.indexOf(this.quality);
    if (this.fpsValue > 0 && this.fpsValue < 45) {
      this.highFpsSince = 0;
      if (this.lowFpsSince === 0) this.lowFpsSince = performance.now();
      if (performance.now() - this.lowFpsSince > 5000 && idx > 0) {
        this.applyEffective(QUALITY_ORDER[idx - 1]);
        this.lowFpsSince = performance.now();
        console.info(`[perf] auto-qualité ↓ ${this.effectiveQuality} (${this.fpsValue} fps)`);
      }
    } else if (this.fpsValue > 58) {
      this.lowFpsSince = 0;
      if (this.effectiveQuality !== this.quality) {
        if (this.highFpsSince === 0) this.highFpsSince = performance.now();
        if (performance.now() - this.highFpsSince > 10000 && idx < userIdx) {
          this.applyEffective(QUALITY_ORDER[idx + 1]);
          this.highFpsSince = performance.now();
          console.info(`[perf] auto-qualité ↑ ${this.effectiveQuality} (${this.fpsValue} fps)`);
        }
      }
    } else {
      this.lowFpsSince = 0;
      this.highFpsSince = 0;
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.fpsEl?.remove();
    this.renderer.dispose();
  }
}
