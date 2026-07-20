// ============================================================================
// STRIKE 2025 — InputCapture.ts
// Capture des entrées jeu : Pointer Lock sur clic du canvas, touches par
// `e.code` (layout physique — ZQUD et WASD et flèches fonctionnent), souris →
// yaw/pitch avec sensibilité du store, molette + 1/2 switch slot, R reload,
// 4 streak UAV, Shift sprint, Espace saut, Ctrl/C crouch. Produit le bitmask
// KEY_* de sim.ts.
//
// La capture clavier/souris de jeu n'est active que lorsque `enabled` (phase
// playing/dead) ; les mouvements souris ne sont lus qu'en pointer lock.
// ============================================================================

import {
  KEY_ADS,
  KEY_BACK,
  KEY_CROUCH,
  KEY_FORWARD,
  KEY_JUMP,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_SPRINT,
  clampPitch,
} from '../../shared/sim';

export interface InputCaptureActions {
  /** Demande de switch vers un slot précis (touches 1/2). */
  onSwitchSlot(slot: 0 | 1): void;
  /** Molette : bascule vers l'autre slot. */
  onToggleSlot(): void;
  /** Touche R. */
  onReload(): void;
  /** Touche 4 (streak UAV). */
  onStreak(): void;
  /** Pointer lock acquis/perdu. */
  onLockChange(locked: boolean): void;
}

/** Radians par pixel à sensibilité 1 (la plage store est 0.1..10, défaut 2.5). */
const RAD_PER_PX_BASE = 0.00088;

/** Codes clavier de jeu (preventDefault quand la capture est active). */
const GAME_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'KeyZ', 'KeyQ',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ControlLeft', 'ControlRight', 'KeyC',
  'ShiftLeft', 'ShiftRight', 'KeyR', 'Digit1', 'Digit2', 'Digit4', 'Numpad4',
]);

export class InputCapture {
  /** Orientation courante (radians) — lue par GameClient vers Prediction. */
  yaw = 0;
  pitch = 0;
  /** Sensibilité souris (store settings.sensitivity, appliquée en live). */
  sensitivity = 2.5;
  /** Capture active (GameClient la cale sur la phase UI). */
  enabled = false;

  fireHeld = false;
  adsHeld = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly actions: InputCaptureActions;
  private readonly keysDown = new Set<string>();
  private locked = false;
  /** Deltas souris accumulés entre deux frames. */
  private accDX = 0;
  private accDY = 0;
  /** Deltas effectivement consommés à la dernière frame (pour le sway). */
  lastFrameDX = 0;
  lastFrameDY = 0;
  private fireEdgeQueued = false;

  constructor(canvas: HTMLCanvasElement, actions: InputCaptureActions) {
    this.canvas = canvas;
    this.actions = actions;

    // Pointer lock sur clic du canvas.
    canvas.addEventListener('click', () => {
      if (this.enabled && !this.locked) {
        canvas.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.resetTransient();
      }
      this.actions.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.locked || !this.enabled) return;
      this.accDX += e.movementX;
      this.accDY += e.movementY;
    });
    document.addEventListener('mousedown', (e: MouseEvent) => {
      if (!this.locked || !this.enabled) return;
      if (e.button === 0) {
        this.fireHeld = true;
        this.fireEdgeQueued = true;
      } else if (e.button === 2) {
        this.adsHeld = true;
      }
    });
    document.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.fireHeld = false;
      else if (e.button === 2) this.adsHeld = false;
    });
    canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());

    document.addEventListener('wheel', (e: WheelEvent) => {
      if (!this.locked || !this.enabled) return;
      if (e.deltaY !== 0) this.actions.onToggleSlot();
    }, { passive: true });

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (GAME_CODES.has(e.code)) e.preventDefault();
      if (e.repeat) {
        this.keysDown.add(e.code);
        return;
      }
      this.keysDown.add(e.code);
      switch (e.code) {
        case 'KeyR':
          this.actions.onReload();
          break;
        case 'Digit1':
          this.actions.onSwitchSlot(0);
          break;
        case 'Digit2':
          this.actions.onSwitchSlot(1);
          break;
        case 'Digit4':
        case 'Numpad4':
          this.actions.onStreak();
          break;
        default:
          break;
      }
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
    });
    window.addEventListener('blur', () => this.resetTransient());
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  /** Sortie du pointer lock (appelé par GameClient à la déconnexion). */
  releaseLock(): void {
    if (this.locked && document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  /** Reprise du pointer lock (respawn). Autorisé sans geste utilisateur par
   *  Chromium quand la sortie précédente était PROGRAMMATIQUE
   *  (exitPointerLock à la mort) — sinon l'appel échoue silencieusement et le
   *  prochain clic sur le canvas re-verrouille. */
  requestLock(): void {
    if (this.enabled && !this.locked) {
      try {
        const p = this.canvas.requestPointerLock() as unknown;
        if (p instanceof Promise) p.catch(() => undefined);
      } catch {
        /* refus navigateur : le clic canvas re-verrouillera */
      }
    }
  }

  /** Applique les deltas souris accumulés à yaw/pitch (une fois par frame). */
  consumeLook(): void {
    const k = RAD_PER_PX_BASE * this.sensitivity;
    // Convention sim.ts : souris à droite => regard à droite => yaw diminue.
    this.yaw -= this.accDX * k;
    this.pitch = clampPitch(this.pitch - this.accDY * k);
    this.lastFrameDX = this.accDX;
    this.lastFrameDY = this.accDY;
    this.accDX = 0;
    this.accDY = 0;
  }

  /** Bitmask KEY_* de sim.ts pour l'input courant. */
  computeKeys(): number {
    const k = this.keysDown;
    let bits = 0;
    if (k.has('KeyW') || k.has('KeyZ') || k.has('ArrowUp')) bits |= KEY_FORWARD;
    if (k.has('KeyS') || k.has('ArrowDown')) bits |= KEY_BACK;
    if (k.has('KeyA') || k.has('KeyQ') || k.has('ArrowLeft')) bits |= KEY_LEFT;
    if (k.has('KeyD') || k.has('ArrowRight')) bits |= KEY_RIGHT;
    if (k.has('Space')) bits |= KEY_JUMP;
    if (k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC')) bits |= KEY_CROUCH;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) bits |= KEY_SPRINT;
    if (this.adsHeld) bits |= KEY_ADS;
    return bits;
  }

  /** Clic gauche front montant (armes semi-auto) — consommé une seule fois. */
  consumeFireEdge(): boolean {
    const edge = this.fireEdgeQueued;
    this.fireEdgeQueued = false;
    return edge;
  }

  /** Réinitialise boutons et touches (mort, perte de lock, déconnexion). */
  resetTransient(): void {
    this.keysDown.clear();
    this.fireHeld = false;
    this.adsHeld = false;
    this.fireEdgeQueued = false;
    this.accDX = 0;
    this.accDY = 0;
  }
}
