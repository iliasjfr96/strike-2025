// ============================================================================
// STRIKE 2025 — LoadoutScreen.tsx (design/loadout.md — implémentation complète)
// 3 cartes classes (ASSAUT/CQC/RECON, raccourcis 1/2/3), panneau détail arme
// (rendu + 4 StatBar calculées depuis shared/weapons.ts + accessoires + TTK),
// chip secondaire P9, atouts par classe, barre d'action RETOUR / DÉPLOYER,
// puis compte à rebours d'insertion 3-2-1 -> gameClient.connect (bridge.md §3).
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  ChevronsRight,
  Crosshair as CrosshairIcon,
  EyeOff,
  Shield,
  Thermometer,
  Wind,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGameUI } from '../ui/store';
import { gameClient } from '../game/instance';
import type { ClassId, TeamId, WeaponId } from '../shared/protocol';
import { SCORE_TARGET, SHOT_MAX_DIST } from '../shared/protocol';
import { CLASS_DEFS, CLASS_IDS, WEAPONS } from '../shared/weapons';
import type { WeaponSpec } from '../shared/weapons';
import { MAP_NAME } from '../shared/map';
import {
  Countdown,
  Grain,
  Panel,
  Scanlines,
  SectionHeader,
  StatBar,
  SweepLight,
  TacticalButton,
  teamColorVar,
} from '../ui/components';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

// ----------------------------------------------------------------------------
// Contenu éditorial FR (loadout.md §B/C/D) — les valeurs chiffrées des stats
// sont CALCULÉES depuis shared/weapons.ts (jamais codées en dur).
// ----------------------------------------------------------------------------

interface ClassContent {
  role: string;
  tagline: string;
  icon: LucideIcon;
  operator: string;
  accessories: string[];
  perks: { icon: LucideIcon; label: string }[];
  weaponType: string;
}

const CLASS_CONTENT: Record<ClassId, ClassContent> = {
  assault: {
    role: 'POLYVALENCE — LIGNE DE FRONT',
    tagline: "Précis à mi-distance, efficace en mouvement. L'épine dorsale de l'escouade.",
    icon: Zap,
    operator: '/operator-assault.png',
    accessories: ['VISEUR POINT ROUGE', 'POIGNÉE ERGONOMIQUE'],
    perks: [
      { icon: Shield, label: 'GILET BALISTIQUE' },
      { icon: Zap, label: 'CHARGEURS RAPIDES' },
    ],
    weaponType: "FUSIL D'ASSAUT — CADENCE AUTO",
  },
  cqc: {
    role: 'VITESSE — CORPS À CORPS',
    tagline: 'Cadence extrême, mobilité maximale. Domine les couloirs de conteneurs.',
    icon: ChevronsRight,
    operator: '/operator-cqc.png',
    accessories: ['LASER TACTIQUE', 'CHARGEUR ÉTENDU'],
    perks: [
      { icon: Wind, label: 'POIDS PLUME' },
      { icon: Activity, label: 'CONDITIONNEMENT EXTRÊME' },
    ],
    weaponType: 'PISTOLET-MITRAILLEUR — CADENCE AUTO',
  },
  recon: {
    role: 'PRÉCISION — LONGUE PORTÉE',
    tagline: 'Une balle, une mort. Verrouille les quais depuis la grue portique.',
    icon: CrosshairIcon,
    operator: '/operator-recon.png',
    accessories: ['LUNETTE 8X', 'FREIN DE BOUCHE'],
    perks: [
      { icon: EyeOff, label: 'FANTÔME' },
      { icon: Thermometer, label: 'SANG-FROID' },
    ],
    weaponType: 'FUSIL DE PRÉCISION — VERROU',
  },
};

const CLASS_NAMES: Record<ClassId, string> = { assault: 'ASSAUT', cqc: 'CQC', recon: 'RECON' };

/** Mini-stats condensées des cartes (loadout.md §B) : DÉGÂTS / CADENCE /10. */
function miniStats(w: WeaponSpec): { deg: number; cad: number } {
  return {
    deg: Math.min(10, Math.max(1, Math.round(w.damage / 10))),
    cad: Math.min(10, Math.max(1, Math.round(w.rpm / 100))),
  };
}

/**
 * PORTÉE /10 : dégâts constants (sniper, falloff null) -> 10 ; sinon dérive
 * de la distance de chute + précision ADS (dispersion) de l'arme.
 */
function rangeSegments(w: WeaponSpec): number {
  if (!w.falloff) return 10;
  const base = Math.round((w.falloff.start / 25) * 5);
  const bonus = w.spread.ads <= 0.35 ? 1 : w.spread.ads >= 0.5 ? -2 : 0;
  return Math.min(10, Math.max(1, base + bonus));
}

function rangeLabel(segments: number): string {
  if (segments >= 8) return 'EXTRÊME';
  if (segments >= 5) return 'MOYENNE';
  return 'COURTE';
}

/** MOBILITÉ /10 : multiplicateur de vitesse réel de l'arme (0.95..1.08). */
function mobilitySegments(w: WeaponSpec): number {
  return Math.min(10, Math.max(1, Math.round((w.mobility - 0.6) * 20)));
}

/** TTK théorique torse (ms) : (balles requises - 1) × intervalle de tir. */
function ttkLabel(w: WeaponSpec): string {
  if (w.damage >= 90) return '1 BALLE';
  const shots = Math.ceil(100 / w.damage);
  const ms = Math.round(((shots - 1) * 60000) / w.rpm);
  return `${ms.toLocaleString('fr-FR')} MS`;
}

function weaponRender(weapon: WeaponId): string {
  return `/weapon-${weapon === 'vsk27' ? 'vsk27' : weapon === 'kv9' ? 'kv9' : weapon === 'lr50' ? 'lr50' : 'p9'}.png`;
}

// ----------------------------------------------------------------------------
// Carte classe (loadout.md §B)
// ----------------------------------------------------------------------------

interface ClassCardProps {
  classId: ClassId;
  index: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onHover: () => void;
  onLeave: () => void;
}

function ClassCard({ classId, index, selected, dimmed, onSelect, onHover, onLeave }: ClassCardProps) {
  const def = CLASS_DEFS[classId];
  const content = CLASS_CONTENT[classId];
  const weapon = WEAPONS[def.loadout[0]];
  const mini = miniStats(weapon);
  const Icon = content.icon;
  const reduced = useReducedMotion();

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 24 }}
      animate={{
        opacity: dimmed ? 0.55 : 1,
        y: 0,
        translateY: selected ? -8 : 0,
      }}
      whileHover={{ y: selected ? -8 : -4 }}
      transition={{
        delay: reduced ? 0 : 0.15 + index * 0.09,
        duration: 0.3,
        ease: EASE_OUT_EXPO,
        translateY: { duration: 0.18, ease: EASE_OUT_EXPO },
      }}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      aria-pressed={selected}
      className={[
        'group relative flex w-full flex-col overflow-hidden text-left',
        'chamfer-20 border bg-[rgba(10,15,20,0.78)] backdrop-blur-md',
        'transition-[border-color,box-shadow] duration-fast',
        selected
          ? 'border-line-strong shadow-[0_0_24px_rgba(245,158,31,0.12)]'
          : 'border-line hover:border-line-strong',
      ].join(' ')}
    >
      {/* Filet ambre latéral 3 px (sélection) */}
      {selected && <span aria-hidden="true" className="absolute inset-y-0 left-0 z-10 w-[3px] bg-amber" />}
      {/* Pastille SÉLECTIONNÉE */}
      {selected && (
        <span className="absolute right-3 top-3 z-10 chamfer-6 bg-amber/15 px-2 py-0.5 font-hud text-[11px] font-semibold uppercase tracking-[0.22em] text-amber">
          SÉLECTIONNÉE
        </span>
      )}
      {/* Hover sweep */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1/3 -translate-x-[130%] bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:animate-sweep"
      />

      {/* Visuel opérateur (cadré haut : tête/torse/arme, masque dégradé) */}
      <div className="relative h-[340px] shrink-0 overflow-hidden">
        <div className="glow-steel absolute inset-0" aria-hidden="true" />
        <img
          src={content.operator}
          alt={`Opérateur ${CLASS_NAMES[classId]}`}
          draggable={false}
          className="absolute inset-x-0 bottom-0 mx-auto h-full w-full object-cover object-[50%_15%] transition-transform duration-med ease-out-expo group-hover:scale-[1.06]"
          style={{
            maskImage: 'linear-gradient(180deg, black 55%, transparent 98%)',
            WebkitMaskImage: 'linear-gradient(180deg, black 55%, transparent 98%)',
          }}
        />
        {/* Icône de rôle en coin */}
        <span className="absolute left-3 top-3 text-steel">
          <Icon size={18} strokeWidth={1.5} />
        </span>
        {/* Raccourci clavier */}
        <span className="absolute bottom-2 right-3 font-mono text-[12px] text-text-dim">
          [{index + 1}]
        </span>
      </div>

      <div className="relative flex flex-1 flex-col gap-1 px-5 pb-5 pt-2">
        <h3 className="font-display text-[36px] font-bold uppercase leading-none tracking-[0.06em] text-text-hi">
          {CLASS_NAMES[classId]}
        </h3>
        <p className="font-hud text-[13px] font-semibold uppercase tracking-[0.18em] text-steel">
          {content.role}
        </p>
        <p className="mt-1 font-display text-[22px] font-semibold uppercase tracking-[0.06em] text-amber">
          {weapon.name}
        </p>
        <p className="mt-1 min-h-[40px] font-hud text-[14px] font-medium leading-snug text-text-mid">
          {content.tagline}
        </p>
        {/* Mini-stats condensées (5 segments) */}
        <div className="mt-3 flex flex-col gap-2">
          {(
            [
              ['DÉGÂTS', mini.deg],
              ['CADENCE', mini.cad],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-center gap-3">
              <span className="w-[64px] font-hud text-[11px] font-semibold uppercase tracking-[0.2em] text-text-dim">
                {label}
              </span>
              <span className="flex gap-[3px]">
                {Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="h-[10px] w-[14px]"
                    style={{ background: i < Math.round(value / 2) ? 'var(--amber)' : 'rgba(127,168,201,0.12)' }}
                  />
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </motion.button>
  );
}

// ----------------------------------------------------------------------------
// Panneau détail arme (loadout.md §C)
// ----------------------------------------------------------------------------

function WeaponDetail({ classId, preview }: { classId: ClassId; preview: boolean }) {
  const def = CLASS_DEFS[classId];
  const content = CLASS_CONTENT[classId];
  const weapon = WEAPONS[def.loadout[0]];
  const range = rangeSegments(weapon);
  const reduced = useReducedMotion();

  return (
    <Panel
      className="flex h-full w-full flex-col p-6"
      style={{ opacity: preview ? 0.7 : 1, transition: 'opacity 200ms cubic-bezier(0.16,1,0.3,1)' }}
    >
      <p className="font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-steel">
        /// ARME PRINCIPALE
      </p>
      <div className="mt-1 flex items-baseline justify-between">
        <h3 className="font-display text-[32px] font-bold uppercase leading-none tracking-[0.05em] text-text-hi">
          {weapon.name}
        </h3>
      </div>
      <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-text-dim">
        {content.weaponType}
      </p>

      {/* Rendu arme sur socle acier + flottement idle */}
      <div className="relative mt-4 flex h-[150px] items-center justify-center">
        <div className="glow-steel absolute inset-0" aria-hidden="true" />
        <AnimatePresence mode="wait">
          <motion.div
            key={weapon.id}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12, transition: { duration: 0.12 } }}
            transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
            className="relative w-full"
          >
            <motion.div
              animate={reduced ? undefined : { y: [0, -3, 0] }}
              transition={reduced ? undefined : { duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <img
                src={weaponRender(weapon.id)}
                alt={`Rendu ${weapon.name}`}
                draggable={false}
                className="mx-auto max-h-[140px] w-full object-contain drop-shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
              />
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 4 StatBar — valeurs calculées depuis shared/weapons.ts */}
      <div className="mt-5 flex flex-col gap-4" key={weapon.id}>
        <StatBar label="DÉGÂTS" value={weapon.damage} max={100} displayValue={String(weapon.damage)} />
        <StatBar
          label="CADENCE"
          value={Math.max(50, weapon.rpm)}
          max={1000}
          displayValue={`${weapon.rpm} C/M`}
        />
        <StatBar label="PORTÉE" value={range} max={10} tone="steel" displayValue={rangeLabel(range)} />
        <StatBar
          label="MOBILITÉ"
          value={mobilitySegments(weapon)}
          max={10}
          tone="steel"
          displayValue={`${Math.round(weapon.mobility * 100)} %`}
        />
      </div>

      {/* Accessoires */}
      <p className="mt-5 font-hud text-[11px] font-semibold uppercase tracking-[0.2em] text-text-dim">
        ACCESSOIRES
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {content.accessories.map((acc) => (
          <span
            key={acc}
            className="chamfer-6 inline-flex items-center gap-2 border border-line px-3 py-1.5 font-hud text-[14px] font-medium tracking-[0.06em] text-text-mid"
          >
            <CrosshairIcon size={13} strokeWidth={1.5} className="text-steel" />
            {acc}
          </span>
        ))}
      </div>

      <div className="mt-auto pt-4 font-mono text-[12px] uppercase tracking-[0.06em] text-text-dim">
        TTK THÉORIQUE (TORSE) : <span className="text-text-hi">{ttkLabel(weapon)}</span>
        {!weapon.falloff && (
          <span className="block">PORTÉE MAX : {SHOT_MAX_DIST} M — DÉGÂTS CONSTANTS</span>
        )}
      </div>
    </Panel>
  );
}

// ----------------------------------------------------------------------------
// Compte à rebours d'insertion (loadout.md §E)
// ----------------------------------------------------------------------------

function InsertionOverlay({ classId, pseudo }: { classId: ClassId; pseudo: string }) {
  const def = CLASS_DEFS[classId];
  const primary = WEAPONS[def.loadout[0]];
  const [step, setStep] = useState(3);
  const [line, setLine] = useState(0);

  const LINES = useMemo(
    () => ['SYNCHRONISATION SERVEUR…', `CHARGEMENT ${MAP_NAME}…`, `BONNE CHASSE, ${pseudo}.`],
    [pseudo],
  );

  useEffect(() => {
    const t = window.setInterval(() => setStep((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    setLine(Math.min(LINES.length - 1, 3 - step));
  }, [step, LINES.length]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[rgba(4,6,8,0.75)] backdrop-blur-[8px]"
      role="status"
      aria-label="Insertion imminente"
    >
      <div className="vignette-hud pointer-events-none absolute inset-0" aria-hidden="true" />
      <p className="font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-steel">
        /// INSERTION IMMINENTE
      </p>
      <div className="mt-4">
        <Countdown value={step > 0 ? step : 1} />
      </div>
      <p className="mt-4 h-5 font-mono text-[14px] uppercase tracking-[0.1em] text-text-mid">
        {LINES[line]}
      </p>
      <p className="absolute bottom-16 font-display text-[20px] font-semibold uppercase tracking-[0.1em] text-amber">
        {CLASS_NAMES[classId]} — {primary.name} + {WEAPONS.p9.name}
      </p>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// Écran
// ----------------------------------------------------------------------------

export default function LoadoutScreen() {
  const pseudo = useGameUI((s) => s.pseudo);
  const classId = useGameUI((s) => s.classId);
  const setClassId = useGameUI((s) => s.setClassId);
  const backToMenu = useGameUI((s) => s.backToMenu);
  const pingMs = useGameUI((s) => s.pingMs);
  const myTeam = useGameUI((s) => s.myTeam);

  const [hovered, setHovered] = useState<ClassId | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const backTimer = useRef<number | null>(null);
  const reduced = useReducedMotion();

  const detailClass = hovered ?? classId;
  const team: TeamId = myTeam ?? 0;

  const deploy = () => {
    if (deploying) return;
    setDeploying(true);
  };

  // Compte à rebours d'insertion terminé -> connexion (bridge.md §3)
  useEffect(() => {
    if (!deploying) return;
    const t = window.setTimeout(() => {
      gameClient.connect(pseudo, classId);
    }, 3200);
    return () => window.clearTimeout(t);
  }, [deploying, pseudo, classId]);

  const requestBack = () => {
    if (confirmBack) {
      backToMenu();
      return;
    }
    setConfirmBack(true);
    if (backTimer.current) window.clearTimeout(backTimer.current);
    backTimer.current = window.setTimeout(() => setConfirmBack(false), 2500);
  };

  // Clavier : 1/2/3 classes, Entrée = DÉPLOYER, Échap = RETOUR (confirm inline)
  // — pendant l'insertion, Échap annule le compte à rebours (avant connect).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (deploying) {
        if (e.key === 'Escape') setDeploying(false);
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const id = CLASS_IDS[Number(e.key) - 1];
        if (id) setClassId(id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        deploy();
      } else if (e.key === 'Escape') {
        requestBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploying, confirmBack, setClassId]);

  useEffect(
    () => () => {
      if (backTimer.current) window.clearTimeout(backTimer.current);
    },
    [],
  );

  return (
    <section className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-deep" aria-label="Sélection de classe">
      {/* Fond : menu-bg assombri + grille technique + vignette */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/menu-bg.png)', filter: 'brightness(0.45) blur(6px)' }}
      />
      <div aria-hidden="true" className="tech-grid absolute inset-0" />
      <div aria-hidden="true" className="vignette-hud absolute inset-0" />
      <div className="z-10">
        <Scanlines />
        <Grain />
        <SweepLight />
      </div>

      {/* ===== A. En-tête (96 px) ===== */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
        className="relative z-20 flex items-start justify-between px-12 pt-8 xl:px-16"
      >
        <div>
          <SectionHeader kicker="CONFIGURATION D'UNITÉ" title="SÉLECTION DE CLASSE" />
          <p className="mt-3 font-mono text-[13px] uppercase tracking-[0.08em] text-text-mid">
            MODE : MATCH À MORT PAR ÉQUIPE — CARTE : {MAP_NAME} — PREMIER À {SCORE_TARGET}
          </p>
        </div>
        {/* Chip identité */}
        <Panel className="flex items-center gap-4 px-5 py-3" brackets={false}>
          <span className="font-display text-[20px] font-semibold uppercase tracking-[0.06em] text-text-hi">
            {pseudo}
          </span>
          <span className="flex items-center gap-2 font-hud text-[12px] font-semibold uppercase tracking-[0.18em]" style={{ color: teamColorVar(team) }}>
            <span aria-hidden="true" className="inline-block h-[6px] w-[6px]" style={{ background: teamColorVar(team) }} />
            {team === 0 ? 'SPECTRE' : 'RAVAGE'}
          </span>
          <span className="font-mono text-[13px] text-text-mid [font-variant-numeric:tabular-nums]">
            {pingMs > 0 ? pingMs : 24} MS
          </span>
        </Panel>
      </motion.header>

      {/* ===== Zone principale ===== */}
      <main className="relative z-20 flex min-h-0 flex-1 items-stretch gap-6 px-12 pt-6 xl:px-16">
        {/* 3 cartes classes */}
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-6">
          {CLASS_IDS.map((id, i) => (
            <ClassCard
              key={id}
              classId={id}
              index={i}
              selected={classId === id}
              dimmed={classId !== id}
              onSelect={() => setClassId(id)}
              onHover={() => setHovered(id)}
              onLeave={() => setHovered(null)}
            />
          ))}
        </div>
        {/* Panneau détail arme (480 px) */}
        <motion.aside
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: reduced ? 0 : 0.25, duration: 0.3, ease: EASE_OUT_EXPO }}
          className="w-[480px] shrink-0"
        >
          <WeaponDetail classId={detailClass} preview={hovered !== null && hovered !== classId} />
        </motion.aside>
      </main>

      {/* ===== D. Barre d'action (88 px) ===== */}
      <motion.footer
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ delay: reduced ? 0 : 0.35, duration: 0.24, ease: EASE_OUT_EXPO }}
        className="relative z-20 mt-6 flex h-[88px] items-center justify-between border-t border-line bg-[rgba(6,9,12,0.55)] px-12 backdrop-blur-md xl:px-16"
      >
        {/* Secondaire P9 */}
        <div>
          <p className="mb-1 font-hud text-[11px] font-semibold uppercase tracking-[0.22em] text-text-dim">
            ARME SECONDAIRE — TOUCHE 2
          </p>
          <Panel className="flex h-14 w-[260px] items-center gap-3 px-4" brackets={false}>
            <img src="/weapon-p9.png" alt="P9" draggable={false} className="h-[40px] w-auto object-contain" />
            <span className="font-hud text-[14px] font-semibold uppercase tracking-[0.1em] text-text-hi">
              P9 — PISTOLET
            </span>
            <span className="ml-auto chamfer-6 bg-steel/15 px-2 py-0.5 font-hud text-[10px] font-semibold uppercase tracking-[0.2em] text-steel">
              COMMUN
            </span>
          </Panel>
        </div>

        {/* Atouts */}
        <div className="hidden flex-col items-center gap-1 lg:flex">
          <p className="font-hud text-[11px] font-semibold uppercase tracking-[0.22em] text-text-dim">
            ÉQUIPEMENT TACTIQUE : GRENADE FLASH
          </p>
          <div className="flex gap-3">
            {CLASS_CONTENT[classId].perks.map((perk) => {
              const PerkIcon = perk.icon;
              return (
                <span
                  key={perk.label}
                  className="chamfer-6 inline-flex items-center gap-2 border border-line bg-[rgba(13,19,26,0.6)] px-3 py-1.5 font-hud text-[13px] font-medium uppercase tracking-[0.08em] text-text-mid"
                >
                  <PerkIcon size={14} strokeWidth={1.5} className="text-steel" />
                  {perk.label}
                </span>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <TacticalButton variant="ghost" onClick={requestBack}>
            {confirmBack ? 'CONFIRMER LE RETOUR ?' : '« RETOUR'}
          </TacticalButton>
          <div className="relative">
            <div className="glow-amber pointer-events-none absolute -inset-4" aria-hidden="true" />
            <TacticalButton
              variant="primary"
              hero
              disabled={deploying}
              title="DÉPLOYER"
              onClick={deploy}
              className="h-14 text-[22px]"
            >
              DÉPLOYER »
            </TacticalButton>
          </div>
        </div>
      </motion.footer>

      {/* ===== E. Compte à rebours d'insertion ===== */}
      <AnimatePresence>{deploying && <InsertionOverlay classId={classId} pseudo={pseudo} />}</AnimatePresence>
    </section>
  );
}
