// ============================================================================
// STRIKE 2025 — ScoreStrip.tsx (hud.md Module 5 — score & chrono haut-centre)
// Bloc 300×56 à chanfreins, 16 px du bord haut : scores SPECTRE/RAVAGE
// (Saira C. 700 30 px couleurs équipe, number tick §7.10) + chrono central
// Share Tech Mono 26 px (clignote --danger sous 60 s, pulse 1 s). Filet
// supérieur 2 px de l'équipe en tête. Sous-label « MATCH À MORT… ».
// Champs store lus (bridge.md §2) : scores, matchEndsAt, serverOffsetMs.
// ============================================================================

import { AnimatePresence, motion } from 'framer-motion';
import { useGameUI } from './store';
import { MATCH_DURATION_S, SCORE_TARGET } from '../shared/protocol';
import { useNow } from './useNow';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

/** Chiffre avec « number tick » mécanique (§7.10) à chaque changement. */
function TickNumber({ value, color }: { value: number; color: string }) {
  return (
    <span className="relative inline-block h-[34px] w-[44px] overflow-hidden text-center">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '-100%' }}
          transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
          className="inline-block font-display text-[30px] font-bold leading-[34px] [font-variant-numeric:tabular-nums]"
          style={{ color }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function ScoreStrip() {
  const scores = useGameUI((s) => s.scores);
  const matchEndsAt = useGameUI((s) => s.matchEndsAt);
  const serverOffsetMs = useGameUI((s) => s.serverOffsetMs);
  const now = useNow(1000);

  const remainingS =
    matchEndsAt > 0
      ? Math.max(0, Math.ceil((matchEndsAt - serverOffsetMs - now) / 1000))
      : MATCH_DURATION_S;
  const lowTime = matchEndsAt > 0 && remainingS <= 60;

  const leader: 0 | 1 | -1 = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : -1;

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
      <div className="chamfer-14 panel-surface relative flex h-14 w-[300px] items-stretch justify-between px-4">
        {/* Filet supérieur 2 px de l'équipe en tête */}
        {leader !== -1 && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[2px]"
            style={{ background: leader === 0 ? 'var(--spectre)' : 'var(--ravage)' }}
          />
        )}
        {/* SPECTRE */}
        <div className="flex flex-col items-center justify-center">
          <TickNumber value={scores[0]} color="var(--spectre)" />
          <span className="font-hud text-[10px] font-semibold uppercase tracking-[0.22em] text-text-dim">
            SPECTRE
          </span>
        </div>
        {/* Chrono */}
        <div className="flex items-center justify-center border-x border-line px-3">
          <motion.span
            key={remainingS}
            animate={lowTime ? { scale: [1.06, 1] } : undefined}
            transition={{ duration: 0.3 }}
            className="font-mono text-[26px] [font-variant-numeric:tabular-nums]"
            style={{
              color: lowTime ? 'var(--danger)' : 'var(--text-hi)',
              animation: lowTime ? 'low-health-throb 1s cubic-bezier(0.45,0,0.55,1) infinite' : undefined,
            }}
          >
            {formatClock(remainingS)}
          </motion.span>
        </div>
        {/* RAVAGE */}
        <div className="flex flex-col items-center justify-center">
          <TickNumber value={scores[1]} color="var(--ravage)" />
          <span className="font-hud text-[10px] font-semibold uppercase tracking-[0.22em] text-text-dim">
            RAVAGE
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-center font-hud text-[10px] font-semibold uppercase tracking-[0.22em] text-text-dim">
        MATCH À MORT PAR ÉQUIPE — PREMIER À {SCORE_TARGET}
      </p>
    </div>
  );
}
