// ============================================================================
// STRIKE 2025 — MainMenu.tsx (design/menu.md — implémentation complète)
// Écran titre : visuel port crépuscule + scrim cinéma + Ken Burns lent, boot
// flicker skippable, logo, champ INDICATIF validé, bouton JOUER hero ->
// « RECHERCHE DE PARTIE… » -> phase loadout, panneau PARAMÈTRES coulissant
// (réglages persistés), barre de statut basse. Textes FR exacts de menu.md.
// ============================================================================

import { useEffect, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import { Hammer, Settings, Target, Users, Volume2, VolumeX, X } from 'lucide-react';
import { useGameUI } from '../ui/store';
import type { QualityLevel } from '../ui/store';
import {
  CornerBrackets,
  Grain,
  Panel,
  Scanlines,
  SectionHeader,
  Segmented,
  Slider,
  SweepLight,
  TacticalButton,
} from '../ui/components';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

/** Volume de secours pour le blip de réinitialisation (si volume à 0). */
const DEFAULT_VOLUME_BLIP = 40;

/** Validation de l'indicatif : 3–14 caractères [A-Za-z0-9_-] (menu.md B). */
const PSEUDO_RE = /^[A-Za-z0-9_-]{3,14}$/;
const PSEUDO_MAX = 14;

const QUALITY_OPTIONS: { value: QualityLevel; label: string }[] = [
  { value: 'low', label: 'FAIBLE' },
  { value: 'medium', label: 'MOYEN' },
  { value: 'high', label: 'ÉLEVÉ' },
  { value: 'ultra', label: 'ULTRA' },
];

// ----------------------------------------------------------------------------
// Audio procédural minimal (design.md §9 — aucun asset audio)
// ----------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

function blip(freq: number, durationMs: number, volume: number, muted: boolean) {
  if (muted || volume <= 0) return;
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    const v = (volume / 100) * 0.08;
    gain.gain.setValueAtTime(v, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch {
    /* WebAudio indisponible : silencieux */
  }
}

// ----------------------------------------------------------------------------
// Conversion FOV horizontal -> vertical (16:9) — sous-texte live (menu.md E.2)
// ----------------------------------------------------------------------------

function horizontalToVerticalFov(h: number): number {
  return Math.round(2 * Math.atan(Math.tan((h * Math.PI) / 360) / (16 / 9)) * (360 / Math.PI));
}

// ----------------------------------------------------------------------------
// Horloge locale (menu.md D — coin supérieur droit)
// ----------------------------------------------------------------------------

function useLocalClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now.toLocaleTimeString('fr-FR', { hour12: false });
}

// ============================================================================

export default function MainMenu() {
  // ---- Store ----
  const pseudo = useGameUI((s) => s.pseudo);
  const setPseudo = useGameUI((s) => s.setPseudo);
  const goToLoadout = useGameUI((s) => s.goToLoadout);
  const connectionError = useGameUI((s) => s.connectionError);
  const players = useGameUI((s) => s.players);
  const pingMs = useGameUI((s) => s.pingMs);
  const settings = useGameUI((s) => s.settings);
  const setSettings = useGameUI((s) => s.setSettings);
  const resetSettings = useGameUI((s) => s.resetSettings);

  // ---- État local ----
  const [bootSkipped, setBootSkipped] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchAlt, setSearchAlt] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [invalidShake, setInvalidShake] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [simPing, setSimPing] = useState(24);
  const reducedMotion = useReducedMotion();
  const clock = useLocalClock();

  const pseudoValid = PSEUDO_RE.test(pseudo);
  const showInvalidHint = pseudo.length > 0 && !pseudoValid;

  // ---- Boot skippable (menu.md animations : 2,2 s, skippable au clic) ----
  useEffect(() => {
    if (reducedMotion) {
      setBootSkipped(true);
      return;
    }
    const t = window.setTimeout(() => setBootSkipped(true), 2400);
    return () => window.clearTimeout(t);
  }, [reducedMotion]);

  const bootDelay = (base: number) => (bootSkipped || reducedMotion ? 0 : base);

  // ---- Ping simulé (tick 3 s ±8 ms, menu.md D) tant que non connecté ----
  useEffect(() => {
    const t = window.setInterval(() => setSimPing(24 + Math.round(Math.random() * 16 - 8)), 3000);
    return () => window.clearInterval(t);
  }, []);
  const shownPing = pingMs > 0 ? Math.round(pingMs) : simPing;

  // ---- Alternance du texte de recherche (toutes les 1,6 s, menu.md B) ----
  useEffect(() => {
    if (!searching) return;
    const t = window.setInterval(() => setSearchAlt((v) => !v), 1600);
    return () => window.clearInterval(t);
  }, [searching]);

  // ---- Échap ferme tout overlay ouvert (menu.md interactions) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Parallaxe curseur 2 couches (menu.md interactions, lerp doux) ----
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 55, damping: 18, mass: 0.6 });
  const sy = useSpring(my, { stiffness: 55, damping: 18, mass: 0.6 });
  const bgX = useTransform(sx, [-1, 1], [-3, 3]);
  const bgY = useTransform(sy, [-1, 1], [-3, 3]);
  const fgX = useTransform(sx, [-1, 1], [-6, 6]);
  const fgY = useTransform(sy, [-1, 1], [-6, 6]);

  const onMouseMove = (e: React.MouseEvent) => {
    if (reducedMotion || settings.quality === 'low') return;
    mx.set((e.clientX / window.innerWidth) * 2 - 1);
    my.set((e.clientY / window.innerHeight) * 2 - 1);
  };

  // ---- Actions ----
  const play = () => {
    if (!pseudoValid) {
      setInvalidShake((n) => n + 1);
      return;
    }
    if (searching) return;
    blip(140, 90, settings.volume, settings.muted); // « chunk » grave
    setSearching(true);
    const wait = 1800 + Math.random() * 800; // 1,8–2,6 s simulés (menu.md B)
    window.setTimeout(() => {
      goToLoadout();
    }, wait);
  };

  const onPseudoChange = (raw: string) => {
    setPseudo(raw.toUpperCase().slice(0, PSEUDO_MAX));
  };

  const onPseudoKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (pseudoValid) document.getElementById('btn-jouer')?.focus();
      play();
    }
  };

  const onlineCount = players.length > 0 ? players.length : 12847;

  return (
    <section
      className="tech-grid relative h-full w-full overflow-hidden bg-deep"
      onMouseMove={onMouseMove}
      onClick={() => {
        if (!bootSkipped) setBootSkipped(true);
      }}
    >
      {/* ===== Fond : visuel port crépuscule + Ken Burns lent (z 0) ===== */}
      <motion.div className="absolute inset-0 z-0" style={reducedMotion ? undefined : { x: bgX, y: bgY }}>
        <motion.img
          src="/menu-bg.png"
          alt=""
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            opacity: { duration: bootSkipped ? 0.2 : 0.6 },
            scale: { duration: bootSkipped ? 0.2 : 1.6, ease: EASE_OUT_EXPO },
          }}
          className={`h-full w-full object-cover ${reducedMotion ? '' : 'animate-ken-burns'}`}
        />
      </motion.div>

      {/* ===== Scrims & overlays d'ambiance (z 10) ===== */}
      <div className="scrim-cinema pointer-events-none absolute inset-0 z-10" />
      <div className="vignette-hud pointer-events-none absolute inset-0 z-10" />
      <Scanlines className="z-10" />
      <Grain className="z-10" />
      <SweepLight className="z-10" />

      {/* ===== Scanline blanche du boot (400 ms, linéaire) ===== */}
      {!bootSkipped && (
        <div className="animate-boot-scanline pointer-events-none absolute inset-x-0 top-0 z-30 h-px bg-white/70" />
      )}

      {/* ===== Coin supérieur droit : horloge + muet ===== */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: bootDelay(0.9), duration: 0.24 }}
        className="absolute right-6 top-6 z-20 flex items-center gap-4"
      >
        <span className="font-mono text-[14px] text-text-mid [font-variant-numeric:tabular-nums]">{clock}</span>
        <button
          type="button"
          aria-label={settings.muted ? 'Activer le son' : 'Couper le son'}
          onClick={() => setSettings({ muted: !settings.muted })}
          className="text-text-mid transition-colors duration-fast hover:text-text-hi"
        >
          <motion.span
            key={settings.muted ? 'muted' : 'sound'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.14 }}
            className="block"
          >
            {settings.muted ? <VolumeX size={18} strokeWidth={1.5} /> : <Volume2 size={18} strokeWidth={1.5} />}
          </motion.span>
        </button>
      </motion.div>

      {/* ===== Colonne de contenu (z 20) : ancrée gauche, top 22 % ===== */}
      <motion.div
        className="absolute left-12 top-[22%] z-20 w-[480px] max-w-[calc(100vw-96px)] xl:left-24 xl:w-[560px]"
        style={reducedMotion ? undefined : { x: fgX, y: fgY }}
      >
        {/* ---- A. Zone logo ---- */}
        <div className="relative">
          <div className="glow-amber animate-halo-breath pointer-events-none absolute -inset-10" aria-hidden="true" />
          {/* Boot flicker §7.1 (keyframes CSS, retardées après la scanline) */}
          <img
            src="/logo.svg"
            alt="STRIKE 2025"
            className="h-[clamp(56px,8vh,110px)] w-auto animate-boot-flicker"
            style={{ animationDelay: bootSkipped ? '0ms' : '500ms' }}
          />
        </div>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: bootDelay(0.7), duration: 0.24, ease: EASE_OUT_EXPO }}
          className="mt-4 font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-steel"
        >
          /// OPÉRATIONS MULTIJOUEURS — FUTUR PROCHE
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: bootDelay(0.78), duration: 0.24, ease: EASE_OUT_EXPO }}
          className="mt-2 font-mono text-[14px] tracking-[0.02em] text-text-mid"
        >
          THÉÂTRE : KESTREL YARD // TRIPORT FERROVIAIRE — JOUR COUVERT
        </motion.p>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: bootDelay(0.86), duration: 0.24 }}
          className="separator-tactical mt-5 w-full max-w-[480px]"
          aria-hidden="true"
        />

        {/* ---- B. Bloc connexion ---- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: bootDelay(1.0), duration: 0.24, ease: EASE_OUT_EXPO }}
          className="mt-8"
        >
          <div className="mb-2 flex w-[400px] max-w-full items-baseline justify-between">
            <label htmlFor="pseudo" className="font-hud text-[13px] font-semibold uppercase tracking-[0.18em] text-text-dim">
              INDICATIF
            </label>
            <span className="font-mono text-[12px] text-text-dim [font-variant-numeric:tabular-nums]">
              {pseudo.length}/{PSEUDO_MAX}
            </span>
          </div>
          <motion.div key={invalidShake} className={invalidShake > 0 ? 'animate-shake-x' : ''}>
            <div className="relative w-[400px] max-w-full">
              <input
                id="pseudo"
                type="text"
                value={pseudo}
                onChange={(e) => onPseudoChange(e.target.value)}
                onKeyDown={onPseudoKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                maxLength={PSEUDO_MAX}
                placeholder="ENTREZ VOTRE PSEUDO"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showInvalidHint}
                className={[
                  'chamfer-br-8 h-14 w-full border bg-[rgba(6,9,12,0.6)] px-4',
                  'font-display text-[24px] font-semibold uppercase tracking-[0.06em] text-text-hi',
                  'placeholder:font-hud placeholder:text-[16px] placeholder:font-medium placeholder:normal-case placeholder:tracking-[0.08em] placeholder:text-text-dim',
                  'transition-[border-color,box-shadow] duration-instant',
                  showInvalidHint
                    ? 'border-danger'
                    : inputFocused
                      ? 'border-line-strong shadow-[0_0_18px_rgba(88,166,232,0.12)]'
                      : 'border-line',
                ].join(' ')}
              />
              {/* Équerres d'angle au focus (opacité 0 -> 1, 140 ms) */}
              <span
                aria-hidden="true"
                className={`transition-opacity duration-fast ${inputFocused ? 'opacity-100' : 'opacity-0'}`}
              >
                <CornerBrackets />
              </span>
            </div>
          </motion.div>
          {showInvalidHint && (
            <p className="mt-2 font-hud text-[11px] font-medium uppercase tracking-[0.22em] text-danger">
              INDICATIF INVALIDE — 3 À 14 CARACTÈRES
            </p>
          )}
          {connectionError && (
            <p className="mt-2 font-hud text-[11px] font-medium uppercase tracking-[0.22em] text-danger">
              {connectionError}
            </p>
          )}
        </motion.div>

        {/* ---- Bouton JOUER hero ---- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: bootDelay(1.12), duration: 0.24, ease: EASE_OUT_EXPO }}
          className="relative mt-6 w-[400px] max-w-full"
        >
          <div className="glow-amber animate-halo-breath pointer-events-none absolute -inset-6" aria-hidden="true" />
          <TacticalButton
            id="btn-jouer"
            variant="primary"
            hero
            disabled={!pseudoValid || searching}
            title={!pseudoValid ? 'SAISISSEZ UN INDICATIF' : undefined}
            onClick={play}
            className="w-[400px] max-w-full hover:shadow-[0_0_32px_rgba(245,158,31,0.35)]"
          >
            {searching ? (
              <span className="flex items-center gap-3">
                {/* Spinner radar 18 px */}
                <span
                  aria-hidden="true"
                  className="animate-radar-sweep inline-block h-[18px] w-[18px] rounded-full"
                  style={{ background: 'conic-gradient(rgba(10,15,20,0.9), transparent 60deg)' }}
                />
                <span className="font-mono text-[15px] tracking-[0.14em]">
                  {searchAlt ? `PING EU-OUEST : ${shownPing} MS` : 'RECHERCHE DE PARTIE…'}
                </span>
              </span>
            ) : (
              <span className="flex items-center justify-center gap-4">
                <span aria-hidden="true" className="animate-chevron-nudge-l inline-block">»</span>
                JOUER
                <span aria-hidden="true" className="animate-chevron-nudge-r inline-block">»</span>
              </span>
            )}
          </TacticalButton>
        </motion.div>

        {/* ---- C. Actions secondaires ---- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: bootDelay(1.24), duration: 0.24, ease: EASE_OUT_EXPO }}
          className="mt-4 flex gap-4"
        >
          <TacticalButton
            variant="ghost"
            icon={<Settings size={16} strokeWidth={1.5} />}
            disabled={searching}
            onClick={() => {
              blip(2000, 60, settings.volume, settings.muted);
              setSettingsOpen(true);
            }}
          >
            PARAMÈTRES
          </TacticalButton>
          <TacticalButton
            variant="ghost"
            icon={<Target size={16} strokeWidth={1.5} />}
            disabled={searching}
            onClick={() => {
              blip(2000, 60, settings.volume, settings.muted);
              setHelpOpen(true);
            }}
          >
            COMMENT JOUER
          </TacticalButton>
          <TacticalButton
            variant="ghost"
            icon={<Hammer size={16} strokeWidth={1.5} />}
            disabled={searching}
            onClick={() => {
              blip(2000, 60, settings.volume, settings.muted);
              useGameUI.getState().engineSetPhase('editor');
            }}
          >
            ÉDITEUR DE MAP
          </TacticalButton>
          <TacticalButton
            variant="ghost"
            icon={<Users size={16} strokeWidth={1.5} />}
            disabled={searching}
            onClick={() => {
              blip(2000, 60, settings.volume, settings.muted);
              useGameUI.getState().engineSetPhase('community');
            }}
          >
            COMMUNAUTÉ
          </TacticalButton>
        </motion.div>
      </motion.div>

      {/* ===== D. Barre de statut (pied d'écran, z 20) ===== */}
      <motion.footer
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ delay: bootDelay(1.4), duration: 0.24, ease: EASE_OUT_EXPO }}
        className="absolute inset-x-0 bottom-0 z-20 flex h-11 items-center justify-between border-t border-line bg-[rgba(6,9,12,0.55)] backdrop-blur-md"
      >
        <div className="flex items-center gap-8 pl-12 font-mono text-[12px] text-text-mid xl:pl-24">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="animate-online-pulse inline-block h-[6px] w-[6px] rounded-full bg-ok" />
            EN LIGNE : <span className="text-text-hi">{onlineCount.toLocaleString('fr-FR')}</span> JOUEURS
          </span>
          <span>SERVEUR : <span className="text-text-hi">EU-OUEST</span></span>
          <span>
            PING : <span className="text-text-hi [font-variant-numeric:tabular-nums]">{shownPing}</span> MS
          </span>
        </div>
        <div className="flex items-center gap-6 pr-6 font-hud text-[11px] font-medium uppercase tracking-[0.22em] text-text-dim">
          <span>KESTREL YARD — BUILD 2026.07.18-r4</span>
          <span>© STRIKE 2025 — PROTOTYPE TACTIQUE · ARMES : J-TOASTIE / AUSTINCFORD / QUATERNIUS (CC-BY) · TEXTURES : POLY HAVEN (CC0)</span>
          <button
            type="button"
            onClick={() => useGameUI.getState().engineSetPhase('admin')}
            className="uppercase tracking-[0.22em] text-text-dim transition-colors hover:text-text-hi"
          >
            ADMIN
          </button>
        </div>
      </motion.footer>

      {/* ===== E. Panneau PARAMÈTRES (overlay droit, z 40) ===== */}
      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40 bg-[rgba(4,6,8,0.7)] backdrop-blur-sm"
              onClick={() => setSettingsOpen(false)}
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{
                duration: 0.24,
                ease: EASE_OUT_EXPO,
                exit: { duration: 0.2 },
              }}
              className="fixed bottom-12 right-0 top-12 z-40 w-[480px] max-w-[calc(100vw-48px)]"
              role="dialog"
              aria-label="Paramètres"
            >
              <Panel className="flex h-full flex-col bg-[rgba(10,15,20,0.92)] p-8 backdrop-blur-xl">
                <div className="flex items-start justify-between">
                  <SectionHeader kicker="CONFIGURATION" title="PARAMÈTRES" />
                  <TacticalButton
                    variant="ghost"
                    aria-label="Fermer les paramètres"
                    onClick={() => setSettingsOpen(false)}
                    className="h-10 w-10 shrink-0 !px-0"
                  >
                    <X size={16} strokeWidth={1.5} />
                  </TacticalButton>
                </div>

                <div className="mt-8 flex flex-1 flex-col gap-8 overflow-y-auto pr-1">
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08, duration: 0.24, ease: EASE_OUT_EXPO }}
                  >
                    <Slider
                      label="SENSIBILITÉ SOURIS"
                      min={0.1}
                      max={10}
                      step={0.1}
                      value={settings.sensitivity}
                      onChange={(v) => setSettings({ sensitivity: v })}
                      formatValue={(v) => v.toFixed(1)}
                      subText={`MULTIPLICATEUR VISÉE : ×${(settings.sensitivity * 0.3).toFixed(2)}`}
                    />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12, duration: 0.24, ease: EASE_OUT_EXPO }}
                  >
                    <Slider
                      label="CHAMP DE VISION (FOV)"
                      min={70}
                      max={110}
                      step={1}
                      value={settings.fov}
                      onChange={(v) => setSettings({ fov: v })}
                      subText={`VERTICAL : ${horizontalToVerticalFov(settings.fov)}°`}
                    />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.16, duration: 0.24, ease: EASE_OUT_EXPO }}
                  >
                    <Slider
                      label="VOLUME PRINCIPAL"
                      min={0}
                      max={100}
                      step={1}
                      value={settings.volume}
                      onChange={(v) => setSettings({ volume: v })}
                      onCommit={(v) => blip(2000, 60, v, settings.muted)}
                      icon={
                        settings.volume === 0 || settings.muted ? (
                          <VolumeX size={16} strokeWidth={1.5} />
                        ) : (
                          <Volume2 size={16} strokeWidth={1.5} />
                        )
                      }
                    />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.24, ease: EASE_OUT_EXPO }}
                  >
                    <p className="mb-2 font-hud text-[13px] font-semibold uppercase tracking-[0.18em] text-text-dim">
                      QUALITÉ GRAPHIQUE
                    </p>
                    <Segmented
                      ariaLabel="Qualité graphique"
                      options={QUALITY_OPTIONS}
                      value={settings.quality}
                      onChange={(q) => setSettings({ quality: q })}
                    />
                    <p className="mt-2 font-hud text-[11px] font-medium uppercase tracking-[0.22em] text-text-dim">
                      OMBRES, BRUME VOLUMÉTRIQUE, ANTI-ALIASAGE
                    </p>
                  </motion.div>
                </div>

                <div className="mt-8 border-t border-line pt-5">
                  <p className="font-hud text-[11px] font-medium uppercase tracking-[0.22em] text-text-dim">
                    LES RÉGLAGES SONT APPLIQUÉS IMMÉDIATEMENT ET CONSERVÉS LOCALEMENT.
                  </p>
                  <TacticalButton
                    variant="ghost"
                    className="mt-4"
                    title="VALEURS PAR DÉFAUT RESTAURÉES"
                    onClick={() => {
                      resetSettings();
                      blip(140, 90, DEFAULT_VOLUME_BLIP, false);
                    }}
                  >
                    RÉINITIALISER
                  </TacticalButton>
                </div>
              </Panel>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ===== C. Modale COMMENT JOUER (z 40) ===== */}
      <AnimatePresence>
        {helpOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(4,6,8,0.7)] backdrop-blur-sm"
            onClick={() => setHelpOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
              onClick={(e) => e.stopPropagation()}
            >
              <Panel className="w-[520px] max-w-[calc(100vw-48px)] p-8" role="dialog" aria-label="Comment jouer">
                <SectionHeader kicker="BRIEFING" title="COMMENT JOUER" />
                <div className="mt-6 flex flex-col gap-3 font-hud text-[15px] font-medium tracking-[0.08em] text-text-mid">
                  <p>DÉPLACEMENT — ZQSD / WASD · SPRINT — MAJ · SAUT — ESPACE</p>
                  <p>VISÉE — CLIC DROIT · TIR — CLIC GAUCHE · RECHARGER — R</p>
                  <p>SCOREBOARD — TAB · CHANGER D'ARME — 1 / 2 · UAV — 3</p>
                </div>
                <div className="mt-8 flex justify-end">
                  <TacticalButton variant="primary" onClick={() => setHelpOpen(false)}>
                    COMPRIS
                  </TacticalButton>
                </div>
              </Panel>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
