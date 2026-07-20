// ============================================================================
// STRIKE 2025 — Hitmarker.tsx (hud.md Modules 2 & 3)
// X de 4 traits diagonaux 2×12 px à 45° : blanc (hit), --amber (tête),
// --hit-kill scale 1.3 + halo (élimination). Animation §7.6 : scale 1.5->1
// (90 ms expo) -> maintien -> fondu (~350 ms). Max 3 empilés.
// Feed de points (+72 px sous le centre) dérivé des éliminations confirmées :
// « +100 ÉLIMINATION » / « +125 TIR À LA TÊTE » (1 600 ms, max 2 lignes).
// Champ store lu (bridge.md §2) : hitmarkers.
// ============================================================================

import { AnimatePresence, motion } from 'framer-motion';
import { useGameUI } from './store';
import type { HitmarkerEvent } from './store';
import { useNow } from './useNow';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const HIT_TTL_MS = 400;
const FEED_TTL_MS = 1600;

function Marker({ event }: { event: HitmarkerEvent }) {
  const color =
    event.kind === 'kill' ? 'var(--hit-kill)' : event.head ? 'var(--amber)' : 'var(--text-hi)';
  return (
    <motion.div
      initial={{ scale: 1.5, opacity: 1 }}
      animate={{ scale: event.kind === 'kill' ? 1.3 : 1, opacity: [1, 1, 0] }}
      exit={{ opacity: 0 }}
      transition={{
        scale: { duration: 0.09, ease: EASE_OUT_EXPO },
        opacity: { duration: 0.35, times: [0, 0.6, 1], ease: 'easeOut' },
      }}
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      aria-hidden="true"
    >
      {event.kind === 'kill' && (
        <span
          className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgba(255,90,31,0.45), transparent)' }}
        />
      )}
      {/* 4 traits diagonaux 2×12 à 45°, gap 4 px */}
      {[45, 135, 225, 315].map((deg) => (
        <span
          key={deg}
          className="absolute left-1/2 top-1/2 h-[12px] w-[2px]"
          style={{
            background: color,
            transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-9px)`,
            transformOrigin: 'center',
          }}
        />
      ))}
    </motion.div>
  );
}

export default function Hitmarker() {
  const hitmarkers = useGameUI((s) => s.hitmarkers);
  const now = useNow(120);

  const live = hitmarkers.filter((h) => now - h.at < HIT_TTL_MS).slice(-3);
  const feed = hitmarkers
    .filter((h) => h.kind === 'kill' && now - h.at < FEED_TTL_MS)
    .slice(-2);

  return (
    <div className="pointer-events-none fixed inset-0 z-20" aria-hidden="true">
      {/* Marqueurs au centre exact */}
      <AnimatePresence>
        {live.map((h) => (
          <Marker key={h.id} event={h} />
        ))}
      </AnimatePresence>

      {/* Feed de points +72 px sous le centre */}
      <div className="absolute left-1/2 top-1/2 flex translate-x-[-50%] flex-col items-center gap-1" style={{ marginTop: 72 }}>
        <AnimatePresence>
          {feed.map((h) => (
            <motion.div
              key={`feed-${h.id}`}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -6, opacity: 0, transition: { duration: 0.2 } }}
              transition={{ duration: 0.14, ease: EASE_OUT_EXPO }}
              className="font-display text-[18px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: h.head ? 'var(--amber)' : 'var(--text-hi)' }}
            >
              {h.head ? '+125 TIR À LA TÊTE' : '+100 ÉLIMINATION'}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
