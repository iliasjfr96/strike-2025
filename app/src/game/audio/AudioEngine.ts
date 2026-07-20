// ============================================================================
// STRIKE 2025 — AudioEngine.ts
// WebAudio 100 % procédural (aucun asset) : tir distinct par arme (bruit
// filtré + enveloppe), tirs distants atténués par distance, hitmarker (bip
// aigu bref), kill (double bip grave), reload, pas locaux, balayage UAV,
// ambiance portuaire (vent filtré + hum grave en boucle douce).
// L'AudioContext est débloqué au premier geste utilisateur (unlock()).
// Volume global = settings store (volume 0..100 + muet).
// ============================================================================

import type { WeaponId } from '../../shared/protocol';

/** Caractère sonore par arme : bande passante du bruit, durée, gain. */
const CUSTOM_TIMBRE = { freq: 950, q: 1.1, decay: 0.14, gain: 0.9, thump: 0.6 };
const SHOT_TIMBRE: Record<WeaponId, { freq: number; q: number; decay: number; gain: number; thump: number }> = {
  custom1: CUSTOM_TIMBRE,
  custom2: CUSTOM_TIMBRE,
  custom3: CUSTOM_TIMBRE,
  vsk27: { freq: 950, q: 0.8, decay: 0.12, gain: 0.5, thump: 140 },
  kv9: { freq: 1250, q: 0.9, decay: 0.085, gain: 0.42, thump: 170 },
  lr50: { freq: 520, q: 0.7, decay: 0.28, gain: 0.75, thump: 90 },
  p9: { freq: 1500, q: 1.0, decay: 0.07, gain: 0.4, thump: 200 },
  m4: { freq: 1050, q: 0.85, decay: 0.11, gain: 0.48, thump: 150 },
  mp5: { freq: 1350, q: 0.95, decay: 0.075, gain: 0.4, thump: 185 },
  spas12: { freq: 420, q: 0.6, decay: 0.24, gain: 0.85, thump: 70 },
  deagle: { freq: 700, q: 0.8, decay: 0.16, gain: 0.6, thump: 110 },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];
  private volume01 = 0.8;
  private muted = false;

  /** À appeler sur un geste utilisateur (pointerdown / keydown). Idempotent. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.applyVolume();

    // Buffer de bruit blanc partagé (1 s, bouclé).
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  /** Volume principal 0..1 + muet (depuis settings store). */
  setVolume(volume01: number, muted: boolean): void {
    this.volume01 = Math.min(1, Math.max(0, volume01));
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volume01,
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Coups de feu
  // --------------------------------------------------------------------------

  /**
   * Tir d'une arme. `distM` = distance à l'auditeur (0 = tir local) :
   * atténuation + filtrage grave avec la distance.
   */
  shot(weapon: WeaponId, distM: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = SHOT_TIMBRE[weapon];
    const now = ctx.currentTime;
    const att = 1 / (1 + distM / 10);

    // Bruit filtré (claquement).
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = t.freq;
    band.Q.value = t.q;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = distM <= 0 ? 9000 : Math.max(700, 9000 - distM * 110);
    const g = ctx.createGain();
    g.gain.setValueAtTime(t.gain * att, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + t.decay);
    src.connect(band);
    band.connect(low);
    low.connect(g);
    g.connect(this.master);
    src.start(now);
    src.stop(now + t.decay + 0.05);

    // Thump grave (corps du tir).
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(t.thump, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, t.thump * 0.5), now + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.35 * att, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(og);
    og.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /** Clic à vide (chargeur vide). */
  dryFire(): void {
    this.click(2400, 0.03, 0.15);
  }

  /** Changement d'arme. */
  switchClick(): void {
    this.click(900, 0.05, 0.2);
    this.click(500, 0.07, 0.12, 0.06);
  }

  /** Rechargement : deux clacks mécaniques. */
  reload(): void {
    this.click(700, 0.05, 0.22, 0.05);
    this.click(1100, 0.04, 0.18, 0.35);
  }

  // --------------------------------------------------------------------------
  // Feedback combat
  // --------------------------------------------------------------------------

  /** Hitmarker : bip aigu bref (~2,2 kHz, 60 ms). */
  hit(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  /** Kill confirmé : double bip grave. */
  kill(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const freqs = [330, 220];
    for (let i = 0; i < freqs.length; i++) {
      const now = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freqs[i];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.11);
    }
  }

  /** Pas local : tapotement sourd filtré grave. */
  footstep(sprinting: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = sprinting ? 520 : 380;
    const g = ctx.createGain();
    g.gain.setValueAtTime(sprinting ? 0.1 : 0.07, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    src.connect(low);
    low.connect(g);
    g.connect(this.master);
    src.start(now);
    src.stop(now + 0.07);
  }

  /** Balayage UAV : sweep FM discret (~1 s). */
  uav(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(500, now);
    carrier.frequency.exponentialRampToValueAtTime(1300, now + 0.4);
    carrier.frequency.exponentialRampToValueAtTime(500, now + 0.8);
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = 8;
    const modGain = ctx.createGain();
    modGain.gain.value = 60;
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    carrier.connect(g);
    g.connect(this.master);
    carrier.start(now);
    mod.start(now);
    carrier.stop(now + 0.95);
    mod.stop(now + 0.95);
  }

  // --------------------------------------------------------------------------
  // Ambiance portuaire (boucle)
  // --------------------------------------------------------------------------

  /** Vent filtré + hum grave, en boucle douce. Idempotent. */
  startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf || this.ambientNodes.length > 0) return;

    // Vent : bruit bouclé -> lowpass balayé lentement.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 260;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.045;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.master);
    // LFO lent sur le filtre (rafales).
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 130;
    lfo.connect(lfoGain);
    lfoGain.connect(windFilter.frequency);
    wind.start();
    lfo.start();

    // Hum grave (machinerie portuaire).
    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 54;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.022;
    hum.connect(humGain);
    humGain.connect(this.master);
    hum.start();

    this.ambientNodes = [wind, lfo, hum, windGain, humGain];
  }

  stopAmbience(): void {
    for (const n of this.ambientNodes) {
      if (n instanceof AudioScheduledSourceNode) {
        try {
          n.stop();
        } catch {
          /* déjà arrêté */
        }
      }
      n.disconnect();
    }
    this.ambientNodes = [];
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Clic mécanique sec (bruit court filtré passe-haut). */
  private click(freq: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }
}
