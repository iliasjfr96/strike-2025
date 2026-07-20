// ============================================================================
// STRIKE 2025 — EndScreen.tsx (endmatch.md — fin de match, z 20)
// Verdict cinématique VICTOIRE / DÉFAITE / MATCH NUL (révélation lettre par
// lettre + teinte équipe), score final count-up + barres duo, rapport
// personnel (8 stats dérivées de results.stats), carte MVP, XPBar en
// cascade, actions REJOUER / RETOUR AU MENU, scoreboard final (Tab).
// Champs store lus (bridge.md §2) : results, myId, myTeam, pseudo, classId,
// players, matchEndsAt, serverOffsetMs.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Crown, TrendingUp } from 'lucide-react';
import { useGameUI } from '../ui/store';
import type { ClassId, TeamId } from '../shared/protocol';
import { MATCH_DURATION_S, SCORE_TARGET, TEAM_NAMES } from '../shared/protocol';
import { CLASS_DEFS, WEAPONS } from '../shared/weapons';
import { MAP_NAME } from '../shared/map';
import { gameClient } from '../game/instance';
import Scoreboard from '../ui/Scoreboard';
import { formatClock } from '../ui/ScoreStrip';
import { useNow } from '../ui/useNow';
import {
  Grain,
  Panel,
  Scanlines,
  TacticalButton,
  truncateName,
  XPBar,
} from '../ui/components';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const TEAM_COLOR: Record<TeamId, string> = { 0: 'var(--spectre)', 1: 'var(--ravage)' };

/** XP dérivée du score personnel : 1 000 XP par niveau (déterministe). */
const XP_PER_LEVEL = 1000;

/** Count-up 800 ms expo (score final, §Animations 4). */
function CountUp({ value, delay, className, style }: { value: number; delay: number; className?: string; style?: React.CSSProperties }) {
  const [shown, setShown] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const start = performance.now() + delay;
    let raf = 0;
    const loop = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / 800));
      const eased = 1 - Math.pow(2, -10 * p);
      setShown(Math.round(value * (p === 1 ? 1 : eased)));
      if (p < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, reduced]);
  return (
    <span className={className} style={style}>
      {shown}
    </span>
  );
}

/** Verdict lettre par lettre (translateY 60 px + skewX -8°, stagger 45 ms). */
function SplitVerdict({ text, color }: { text: string; color: string }) {
  const reduced = useReducedMotion();
  if (reduced) {
    return (
      <motion.h1
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="font-display text-[clamp(72px,9vw,150px)] font-bold uppercase leading-[0.9] tracking-[0.04em]"
        style={{ color }}
      >
        {text}
      </motion.h1>
    );
  }
  return (
    <h1
      className="relative flex overflow-hidden font-display text-[clamp(72px,9vw,150px)] font-bold uppercase leading-[0.9] tracking-[0.04em]"
      style={{ color }}
      aria-label={text}
    >
      {text.split('').map((ch, i) => (
        <motion.span
          key={`${ch}-${i}`}
          initial={{ y: 60, opacity: 0, skewX: -8 }}
          animate={{ y: 0, opacity: 1, skewX: 0 }}
          transition={{ delay: 0.45 + i * 0.045, duration: 0.5, ease: EASE_OUT_EXPO }}
          className="inline-block"
          aria-hidden="true"
        >
          {ch === ' ' ? ' ' : ch}
        </motion.span>
      ))}
      {/* Onde lumineuse traversant le mot à la fin de la révélation */}
      <motion.span
        aria-hidden="true"
        initial={{ x: '-130%' }}
        animate={{ x: '230%' }}
        transition={{ delay: 0.45 + text.length * 0.045, duration: 0.4, ease: 'easeOut' }}
        className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
    </h1>
  );
}

/** Cellule de stat avec count-up 700 ms. */
function StatCell({
  label,
  value,
  suffix,
  highlight,
  delay,
}: {
  label: string;
  value: number;
  suffix?: string;
  highlight?: boolean;
  delay: number;
}) {
  const [shown, setShown] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const start = performance.now() + delay;
    let raf = 0;
    const loop = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / 700));
      const eased = 1 - Math.pow(2, -10 * p);
      setShown(value * (p === 1 ? 1 : eased));
      if (p < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, reduced]);

  const isDecimal = label === 'RATIO E/M' || label === 'CONTRIBUTION' || label === 'POINTS / ÉLIM.';
  const text = isDecimal
    ? shown.toFixed(label === 'CONTRIBUTION' ? 0 : 2).replace('.', ',')
    : Math.round(shown).toLocaleString('fr-FR');

  return (
    <div className="flex flex-col justify-center bg-[rgba(13,19,26,0.5)] px-4 py-3">
      <span className="font-hud text-[11px] font-semibold uppercase tracking-[0.2em] text-text-dim">
        {label}
      </span>
      <span
        className="mt-0.5 font-display text-[30px] font-bold leading-none [font-variant-numeric:tabular-nums]"
        style={{ color: highlight ? 'var(--amber)' : 'var(--text-hi)' }}
      >
        {text}
        {suffix && <span className="ml-1 text-[18px]">{suffix}</span>}
      </span>
    </div>
  );
}

export default function EndScreen() {
  const results = useGameUI((s) => s.results);
  const myId = useGameUI((s) => s.myId);
  const myTeam = useGameUI((s) => s.myTeam);
  const pseudo = useGameUI((s) => s.pseudo);
  const classId = useGameUI((s) => s.classId);
  const players = useGameUI((s) => s.players);
  const matchEndsAt = useGameUI((s) => s.matchEndsAt);
  const serverOffsetMs = useGameUI((s) => s.serverOffsetMs);
  const goToLoadout = useGameUI((s) => s.goToLoadout);
  const backToMenu = useGameUI((s) => s.backToMenu);
  const now = useNow(500);

  const [boardOpen, setBoardOpen] = useState(false);

  const winner = results?.winner ?? -1;
  const scores = results?.scores ?? [0, 0];
  const stats = useMemo(() => results?.stats ?? [], [results]);
  const mine = stats.find((p) => p.id === myId);
  const mvp = stats.length > 0 ? stats.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  const mvpPlayer = mvp ? players.find((p) => p.id === mvp.id) : undefined;

  const team: TeamId = myTeam ?? 0;
  const victory = winner !== -1 && winner === team;
  const draw = winner === -1;

  const verdict = draw ? 'MATCH NUL' : victory ? 'VICTOIRE' : 'DÉFAITE';
  const verdictColor = draw ? 'var(--text-hi)' : victory ? TEAM_COLOR[team] : 'var(--danger)';
  const subtitle = draw
    ? 'PERSONNE NE GARDE LE PORT'
    : winner === 0
      ? `SPECTRE DOMINE LE ${MAP_NAME}`
      : 'RAVAGE CONTRÔLE LES QUAIS';

  // Durée jouée = durée max - temps restant au moment du verdict
  const remainingAtEndS =
    matchEndsAt > 0 ? Math.max(0, Math.round((matchEndsAt - serverOffsetMs - now) / 1000)) : 0;
  const playedS = Math.max(0, MATCH_DURATION_S - Math.min(MATCH_DURATION_S, remainingAtEndS));

  // Stats personnelles (8 cellules, toutes dérivées de results.stats)
  const kills = mine?.kills ?? 0;
  const deaths = mine?.deaths ?? 0;
  const assists = mine?.assists ?? 0;
  const score = mine?.score ?? 0;
  const teamKills = scores[team] || 0;
  const ratio = kills / Math.max(1, deaths);
  const contribution = teamKills > 0 ? (kills / teamKills) * 100 : 0;

  // XP dérivée du score (+ bonus victoire)
  const xpMatch = score;
  const xpBonus = victory ? 50 : 0;
  const xpTotal = xpMatch + xpBonus;
  const level = Math.floor(xpTotal / XP_PER_LEVEL) + 1;
  const xpInLevel = xpTotal % XP_PER_LEVEL;
  const nextLevelIn = XP_PER_LEVEL - xpInLevel;

  // Décompte « Nouvelle partie » (results.returnAt = timestamp local)
  const returnInS = results ? Math.max(0, Math.ceil((results.returnAt - now) / 1000)) : 0;

  const replay = () => goToLoadout();
  const quitToMenu = () => {
    gameClient.disconnect();
    backToMenu();
  };

  // Clavier : Entrée = REJOUER, Échap = menu (ferme le scoreboard d'abord),
  // Tab = scoreboard final
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setBoardOpen((v) => !v);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        replay();
      } else if (e.key === 'Escape') {
        if (boardOpen) setBoardOpen(false);
        else quitToMenu();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardOpen]);

  const classDef: ClassId = classId;
  const className = CLASS_DEFS[classDef].name.toUpperCase();
  const primaryWeapon = WEAPONS[CLASS_DEFS[classDef].loadout[0]].name;

  return (
    <section className="absolute inset-0 z-20 overflow-hidden" aria-label="Fin de match">
      {/* Fond : frame traitée (saturate 0.5 brightness 0.6) + travelling lent */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: 'url(/menu-bg.png)',
          filter: `saturate(${victory || draw ? 0.5 : 0.35}) brightness(0.6)`,
        }}
        animate={{ scale: [1, 1.05] }}
        transition={{ duration: 12, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
      />
      <div className="scrim-cinema absolute inset-0" aria-hidden="true" />
      <div className="vignette-hud absolute inset-0" aria-hidden="true" />
      {/* Lueur du verdict */}
      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 0.6 }}
        className="absolute inset-x-0 top-0 h-[60%]"
        style={{
          background: `radial-gradient(ellipse 60% 50% at 50% 0%, ${
            draw ? 'rgba(234,240,245,0.08)' : victory ? `${team === 0 ? 'rgba(88,166,232,0.12)' : 'rgba(240,127,19,0.12)'}` : 'rgba(229,72,77,0.08)'
          }, transparent)`,
        }}
      />
      <Scanlines />
      <Grain />

      <div
        className="relative z-10 flex h-full flex-col justify-center px-16 py-10 xl:px-24"
        style={{ opacity: boardOpen ? 0.4 : 1, transition: 'opacity 200ms' }}
      >
        {/* ===== A. Verdict ===== */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.24, ease: EASE_OUT_EXPO }}
          className="font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-steel"
        >
          /// FIN DE L'OPÉRATION — {MAP_NAME}
        </motion.p>
        <SplitVerdict text={verdict} color={verdictColor} />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.3 }}
          className="mt-1 font-hud text-[16px] font-semibold uppercase tracking-[0.2em] text-text-mid"
        >
          {subtitle}
        </motion.p>

        {/* Score final + barres duo */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.25, duration: 0.3 }}
          className="mt-5"
        >
          <p className="flex items-baseline gap-4 font-display text-[44px] font-bold leading-none [font-variant-numeric:tabular-nums]">
            <span className="font-hud text-[13px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAM_COLOR[0] }}>
              SPECTRE
            </span>
            <CountUp value={scores[0]} delay={1350} style={{ color: TEAM_COLOR[0] }} />
            <span className="text-text-dim">—</span>
            <CountUp value={scores[1]} delay={1350} style={{ color: TEAM_COLOR[1] }} />
            <span className="font-hud text-[13px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAM_COLOR[1] }}>
              RAVAGE
            </span>
          </p>
          <div className="mt-3 flex w-[480px] flex-col gap-1.5">
            {([0, 1] as const).map((t) => (
              <div key={t} className="h-2 w-full bg-[rgba(127,168,201,0.12)]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (scores[t] / SCORE_TARGET) * 100)}%` }}
                  transition={{ delay: 1.35, duration: 1, ease: EASE_OUT_EXPO }}
                  className="h-full"
                  style={{ background: TEAM_COLOR[t] }}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[13px] uppercase tracking-[0.08em] text-text-mid">
            DURÉE : {formatClock(playedS)} — SCORE CIBLE : {SCORE_TARGET} — EU-OUEST
          </p>
        </motion.div>

        {/* ===== B/C. Rapport personnel + MVP ===== */}
        <div className="mt-7 flex items-start gap-6">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.5, duration: 0.3, ease: EASE_OUT_EXPO }}
          >
            <Panel className="w-[560px] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-steel">
                  /// RAPPORT PERSONNEL
                </p>
                <span className="chamfer-6 bg-amber/15 px-2 py-0.5 font-hud text-[11px] font-semibold uppercase tracking-[0.18em] text-amber">
                  {className} — {primaryWeapon}
                </span>
              </div>
              <p className="mt-1 font-display text-[22px] font-semibold uppercase tracking-[0.05em] text-text-hi">
                {truncateName(pseudo)}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-px bg-line">
                <StatCell label="ÉLIMINATIONS" value={kills} delay={1600} />
                <StatCell label="MORTS" value={deaths} delay={1650} />
                <StatCell label="RATIO E/M" value={ratio} highlight delay={1700} />
                <StatCell label="ASSISTANCES" value={assists} delay={1750} />
                <StatCell label="ÉLIM. NETTES" value={kills - deaths} delay={1800} />
                <StatCell label="CONTRIBUTION" value={contribution} suffix="%" delay={1850} />
                <StatCell label="SCORE" value={score} delay={1900} />
                <StatCell label="POINTS / ÉLIM." value={score / Math.max(1, kills)} delay={1950} />
              </div>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-dim">
                ÉQUIPE : {TEAM_NAMES[team]} · CLASSE : {className} — {primaryWeapon}
              </p>
            </Panel>

            {/* ===== D. Progression XP ===== */}
            <div className="mt-4 w-[560px]">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[18px] font-semibold uppercase tracking-[0.06em] text-text-hi">
                  NIVEAU {level}
                </span>
                <span className="font-mono text-[12px] uppercase text-text-mid">
                  NIVEAU {level + 1} DANS {nextLevelIn.toLocaleString('fr-FR')} XP
                </span>
              </div>
              <XPBar className="mt-2" value={xpInLevel} max={XP_PER_LEVEL} segments={10} />
              <div className="mt-2 flex flex-col gap-1">
                <motion.span
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 2.1, duration: 0.3, ease: EASE_OUT_EXPO }}
                  className="font-mono text-[13px] uppercase text-amber"
                >
                  +{xpMatch.toLocaleString('fr-FR')} XP MATCH
                </motion.span>
                {xpBonus > 0 && (
                  <motion.span
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 2.4, duration: 0.3, ease: EASE_OUT_EXPO }}
                    className="font-mono text-[13px] uppercase text-amber"
                  >
                    +{xpBonus} XP BONUS VICTOIRE
                  </motion.span>
                )}
              </div>
            </div>
          </motion.div>

          {/* ===== C. Carte MVP ===== */}
          {mvp && (
            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.65, duration: 0.3, ease: EASE_OUT_EXPO }}
            >
              <Panel className="w-[380px] p-5" active={mvp.id === myId} teamColor={mvp.id === myId ? 'var(--amber)' : undefined}>
                <p className="font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-amber">
                  /// MEILLEUR JOUEUR DU MATCH
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Crown size={20} strokeWidth={1.5} className="text-amber" />
                  <span
                    className="font-display text-[26px] font-bold uppercase leading-none"
                    style={{ color: TEAM_COLOR[mvp.team] }}
                  >
                    {truncateName(mvp.name)}
                  </span>
                </div>
                <p className="mt-2 font-mono text-[13px] uppercase tracking-[0.06em] text-text-mid">
                  {mvp.kills} ÉLIM.
                  {mvpPlayer ? ` — ${WEAPONS[CLASS_DEFS[mvpPlayer.classId].loadout[0]].name}` : ''}
                  {' '}— RATIO {(mvp.kills / Math.max(1, mvp.deaths)).toFixed(2).replace('.', ',')}
                </p>
                {mvp.id === myId && (
                  <p className="mt-2 font-display text-[18px] font-semibold uppercase tracking-[0.1em] text-amber">
                    C'EST VOUS.
                  </p>
                )}
              </Panel>
            </motion.div>
          )}
        </div>

        {/* ===== E. Actions ===== */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.9, duration: 0.24, ease: EASE_OUT_EXPO }}
          className="mt-8 flex items-center gap-4"
        >
          <TacticalButton variant="ghost" onClick={quitToMenu}>
            « RETOUR AU MENU
          </TacticalButton>
          <div className="relative">
            <div className="glow-amber pointer-events-none absolute -inset-4" aria-hidden="true" />
            <TacticalButton variant="primary" icon={<TrendingUp size={16} strokeWidth={1.5} />} onClick={replay}>
              REJOUER »
            </TacticalButton>
          </div>
          <button
            type="button"
            onClick={() => setBoardOpen((v) => !v)}
            className="font-hud text-[11px] font-semibold uppercase tracking-[0.22em] text-text-dim underline-offset-4 transition-colors duration-fast hover:text-text-hi"
          >
            TABLEAU COMPLET [TAB]
          </button>
          <span className="ml-auto font-mono text-[13px] uppercase text-text-dim [font-variant-numeric:tabular-nums]">
            NOUVELLE PARTIE DANS {returnInS} S
          </span>
        </motion.div>
      </div>

      {/* Scoreboard final (slide-up 240 ms, z 45) */}
      <AnimatePresence>
        {boardOpen && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
            className="absolute inset-0 z-40"
          >
            <Scoreboard final />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
