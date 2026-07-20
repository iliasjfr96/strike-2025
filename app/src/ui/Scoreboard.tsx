// ============================================================================
// STRIKE 2025 — Scoreboard.tsx (scoreboard.md — overlay touche TAB, z 40)
// Deux panneaux SPECTRE/RAVAGE (emblème, effectif, score d'équipe, filet de
// l'équipe en tête), colonnes PSEUDO / SCORE / ÉLIM. / MORTS / PING, tri par
// score décroissant, ligne du joueur surlignée ambre, couronne MVP d'équipe,
// ping coloré (ok < 50 · ambre 50-99 · danger >= 100), pied de match.
// Ouverture <= 140 ms (le jeu continue derrière, flouté/assombri).
// Variante `final` : persistante en fin de match (hint masqué, curseur libre,
// count-up des scores d'équipe 800 ms).
// Champs store lus (bridge.md §2) : board, players, myId, myTeam, scores,
// matchEndsAt, serverOffsetMs, pingMs.
// ============================================================================

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Crown, Skull } from 'lucide-react';
import { useGameUI } from './store';
import type { BoardEntry } from './store';
import type { TeamId } from '../shared/protocol';
import { MATCH_DURATION_S, SCORE_TARGET, TEAM_NAMES } from '../shared/protocol';
import { MAP_NAME } from '../shared/map';
import { CornerBrackets, truncateName } from './components';
import { formatClock } from './ScoreStrip';
import { useNow } from './useNow';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const TEAM_COLOR: Record<TeamId, string> = { 0: 'var(--spectre)', 1: 'var(--ravage)' };
const TEAM_EMBLEM: Record<TeamId, string> = { 0: '/emblem-spectre.svg', 1: '/emblem-ravage.svg' };

function pingColor(ping: number): string {
  if (ping < 50) return 'var(--ok)';
  if (ping < 100) return 'var(--amber)';
  return 'var(--danger)';
}

/** Count-up 800 ms (variante fin de match) — les entiers démarrent à 0. */
function useCountUp(target: number, enabled: boolean): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      const p = Math.min(1, (t - start) / 800);
      const eased = 1 - Math.pow(2, -10 * p); // expo out
      setValue(Math.round(target * (p === 1 ? 1 : eased)));
      if (p < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return value;
}

interface TeamPanelProps {
  team: TeamId;
  rows: BoardEntry[];
  teamScore: number;
  leading: boolean;
  myId: number;
  pingMs: number;
  final: boolean;
  delay: number;
}

function TeamPanel({ team, rows, teamScore, leading, myId, pingMs, final, delay }: TeamPanelProps) {
  const color = TEAM_COLOR[team];
  const shownScore = useCountUp(teamScore, final);
  const mvpId = rows.length > 0 ? rows[0].id : -1;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.1 } }}
      transition={{ delay, duration: final ? 0.3 : 0.14, ease: EASE_OUT_EXPO }}
      className="chamfer-14 panel-surface relative"
      style={{ boxShadow: `0 0 24px ${team === 0 ? 'rgba(88,166,232,0.08)' : 'rgba(240,127,19,0.08)'}` }}
      aria-label={`Équipe ${TEAM_NAMES[team]}`}
    >
      {/* Filet supérieur 2 px couleur équipe */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px]" style={{ background: color }} />
      <CornerBrackets />

      {/* Bandeau d'équipe */}
      <header className="flex h-12 items-center gap-3 border-b border-line px-5">
        <img src={TEAM_EMBLEM[team]} alt="" className="h-6 w-6" draggable={false} />
        <h3 className="font-display text-[24px] font-bold uppercase tracking-[0.06em]" style={{ color }}>
          {TEAM_NAMES[team]}
        </h3>
        <span className="font-mono text-[12px] uppercase text-text-dim">
          {rows.length} JOUEUR{rows.length > 1 ? 'S' : ''}
        </span>
        <span className="ml-auto flex items-baseline gap-3">
          <span className="font-hud text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color }}>
            {leading ? 'EN TÊTE' : 'À LA POURSUITE'}
          </span>
          <span
            className="font-display text-[34px] font-bold leading-none [font-variant-numeric:tabular-nums]"
            style={{ color }}
          >
            {shownScore}
          </span>
        </span>
      </header>

      {/* En-tête de colonnes */}
      <div className="grid h-8 grid-cols-[1fr_90px_90px_90px_90px] items-center gap-2 border-b border-line px-5 font-hud text-[13px] font-semibold uppercase tracking-[0.18em] text-text-dim">
        <span>PSEUDO</span>
        <span className="text-right">SCORE</span>
        <span className="text-right">ÉLIM.</span>
        <span className="text-right">MORTS</span>
        <span className="text-right">PING</span>
      </div>

      {/* Lignes joueurs */}
      <div className="flex flex-col gap-[2px] p-2">
        {rows.length === 0 && (
          <p className="px-3 py-2 font-mono text-[13px] uppercase text-text-dim opacity-40">
            — EN ATTENTE DE JOUEUR —
          </p>
        )}
        {rows.map((row, i) => {
          const me = row.id === myId;
          return (
            <motion.div
              key={row.id}
              layout="position"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: final ? 0.3 + i * 0.06 : 0.02 + i * 0.02,
                duration: 0.14,
                ease: EASE_OUT_EXPO,
                layout: { duration: 0.24, ease: EASE_OUT_EXPO },
              }}
              className={[
                'relative grid h-11 grid-cols-[1fr_90px_90px_90px_90px] items-center gap-2 px-3',
                me ? 'bg-[rgba(245,158,31,0.10)]' : '',
              ].join(' ')}
            >
              {me && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[2px] bg-amber" />}
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-6 font-mono text-[11px] text-text-dim">{String(i + 1).padStart(2, '0')}</span>
                <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0" style={{ background: color }} />
                <span
                  className={`truncate font-hud text-[16px] font-semibold ${me ? 'text-text-hi' : 'text-text-mid'}`}
                >
                  {truncateName(row.name)}
                </span>
                {me && (
                  <span className="chamfer-6 shrink-0 bg-amber/20 px-1.5 py-0.5 font-hud text-[10px] font-semibold uppercase tracking-[0.18em] text-amber">
                    VOUS
                  </span>
                )}
                {row.id === mvpId && row.score > 0 && (
                  <Crown size={13} strokeWidth={1.5} className="shrink-0 text-amber" aria-label="MVP" />
                )}
                {row.deaths > 0 && row.kills === 0 && (
                  <Skull size={12} strokeWidth={1.5} className="shrink-0 text-danger" aria-label="Zéro élimination" />
                )}
              </span>
              <span className={`text-right font-mono text-[16px] [font-variant-numeric:tabular-nums] ${me ? 'font-bold text-text-hi' : 'text-text-hi'}`}>
                {row.score.toLocaleString('fr-FR')}
              </span>
              <span className={`text-right font-mono text-[16px] [font-variant-numeric:tabular-nums] ${me ? 'font-bold text-text-hi' : 'text-text-mid'}`}>
                {row.kills}
              </span>
              <span className={`text-right font-mono text-[16px] [font-variant-numeric:tabular-nums] ${me ? 'font-bold text-text-hi' : 'text-text-mid'}`}>
                {row.deaths}
              </span>
              <span
                className="text-right font-mono text-[16px] [font-variant-numeric:tabular-nums]"
                style={{ color: me ? pingColor(pingMs) : 'var(--text-dim)' }}
              >
                {me ? pingMs : '—'}
              </span>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}

interface ScoreboardProps {
  /** Variante fin de match : persistante, curseur libre, count-up. */
  final?: boolean;
}

export default function Scoreboard({ final = false }: ScoreboardProps) {
  const board = useGameUI((s) => s.board);
  const players = useGameUI((s) => s.players);
  const myId = useGameUI((s) => s.myId);
  const scores = useGameUI((s) => s.scores);
  const matchEndsAt = useGameUI((s) => s.matchEndsAt);
  const serverOffsetMs = useGameUI((s) => s.serverOffsetMs);
  const pingMs = useGameUI((s) => s.pingMs);
  const now = useNow(1000);

  const remainingS =
    matchEndsAt > 0
      ? Math.max(0, Math.ceil((matchEndsAt - serverOffsetMs - now) / 1000))
      : MATCH_DURATION_S;

  // Fusion board + roster (un joueur sans entrée board démarre à zéro)
  const rowsByTeam: Record<TeamId, BoardEntry[]> = { 0: [], 1: [] };
  for (const p of players) {
    const entry = board[p.id] ?? {
      id: p.id,
      name: p.name,
      team: p.team,
      kills: 0,
      deaths: 0,
      assists: 0,
      score: 0,
      bot: p.bot,
    };
    rowsByTeam[p.team].push(entry);
  }
  rowsByTeam[0].sort((a, b) => b.score - a.score);
  rowsByTeam[1].sort((a, b) => b.score - a.score);

  const leader: TeamId | -1 = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : -1;
  const diff = Math.abs(scores[0] - scores[1]);
  const overtime = matchEndsAt > 0 && remainingS <= 0 && leader === -1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.1 }}
      className="absolute inset-0 z-40 bg-[rgba(4,6,8,0.45)] backdrop-blur-[10px] backdrop-brightness-[0.55]"
      role="dialog"
      aria-label="Tableau des scores"
    >
      <div className="vignette-hud pointer-events-none absolute inset-0" />
      <div className="absolute inset-x-0 top-[8%] mx-auto flex w-[960px] max-w-[calc(100vw-64px)] flex-col gap-4 xl:top-[12%]">
        {/* En-tête */}
        <div className="flex items-end justify-between">
          <div>
            <p className="font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-steel">
              /// STATUT DE L'OPÉRATION
            </p>
            <h2 className="mt-1 font-display text-[34px] font-semibold uppercase leading-none tracking-[0.05em] text-text-hi">
              MATCH À MORT PAR ÉQUIPE — {MAP_NAME}
            </h2>
          </div>
          <p className="font-mono text-[24px] [font-variant-numeric:tabular-nums]" style={{ color: overtime ? 'var(--amber)' : 'var(--text-hi)' }}>
            {overtime ? 'PROLONGATIONS' : `${formatClock(remainingS)} RESTANT`}
          </p>
        </div>

        {/* Panneaux équipe */}
        <TeamPanel team={0} rows={rowsByTeam[0]} teamScore={scores[0]} leading={leader === 0} myId={myId} pingMs={pingMs} final={final} delay={0.02} />
        <TeamPanel team={1} rows={rowsByTeam[1]} teamScore={scores[1]} leading={leader === 1} myId={myId} pingMs={pingMs} final={final} delay={0.06} />

        {/* Pied de match */}
        <footer className="text-center">
          <p className="font-mono text-[13px] uppercase tracking-[0.08em] text-text-mid">
            OBJECTIF : {SCORE_TARGET} ÉLIMINATIONS —{' '}
            {leader === -1
              ? 'ÉGALITÉ PARFAITE'
              : `${TEAM_NAMES[leader]} MÈNE PAR ${diff}`}
          </p>
          {!final && (
            <p className="mt-1 font-hud text-[11px] font-medium uppercase tracking-[0.22em] text-text-dim">
              MAINTENEZ TAB — RELÂCHEZ POUR FERMER
            </p>
          )}
        </footer>
      </div>
    </motion.div>
  );
}
