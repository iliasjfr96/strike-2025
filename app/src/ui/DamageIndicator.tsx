// ============================================================================
// STRIKE 2025 — DamageIndicator.tsx (hud.md Module 10)
// Arcs rouges (gradient, 90° d'ouverture) sur un anneau de 120 px autour du
// réticule, orientés vers la source de dégâts (relYaw : 0 = devant).
// Empilable (max 3) ; cycle : opacity 0 -> 0.9 (60 ms) -> fondu 600 ms.
// Champ store lu (bridge.md §2) : damageIndicators.
// ============================================================================

import { AnimatePresence, motion } from 'framer-motion';
import { useGameUI } from './store';
import { useNow } from './useNow';

const TTL_MS = 700;
const RADIUS = 120;

/** Arc SVG de 90° centré vers le haut, tourné de `relYaw` radians. */
function Arc({ relYaw }: { relYaw: number }) {
  const deg = (relYaw * 180) / Math.PI;
  return (
    <svg
      width={RADIUS * 2}
      height={RADIUS * 2}
      viewBox={`0 0 ${RADIUS * 2} ${RADIUS * 2}`}
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ transform: `translate(-50%, -50%) rotate(${deg}deg)` }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="dmg-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(229,72,77,0)" />
          <stop offset="50%" stopColor="rgba(229,72,77,0.9)" />
          <stop offset="100%" stopColor="rgba(229,72,77,0)" />
        </linearGradient>
      </defs>
      {/* Arc de 90° (de -45° à +45° autour du haut) */}
      <path
        d={describeArc(RADIUS, RADIUS, RADIUS - 14, -45, 45)}
        fill="none"
        stroke="url(#dmg-arc)"
        strokeWidth={10}
        strokeLinecap="round"
      />
    </svg>
  );
}

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [sx, sy] = polar(cx, cy, r, startDeg);
  const [ex, ey] = polar(cx, cy, r, endDeg);
  return `M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`;
}

export default function DamageIndicator() {
  const damageIndicators = useGameUI((s) => s.damageIndicators);
  const now = useNow(120);

  const live = damageIndicators.filter((d) => now - d.at < TTL_MS).slice(-3);

  return (
    <div className="pointer-events-none fixed inset-0 z-20" aria-hidden="true">
      <AnimatePresence>
        {live.map((d) => (
          <motion.div
            key={d.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.9 }}
            exit={{ opacity: 0, transition: { duration: 0.6 } }}
            transition={{ duration: 0.06 }}
          >
            <Arc relYaw={d.relYaw} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
