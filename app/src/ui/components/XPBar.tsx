// STRIKE 2025 — <XPBar> (design.md §10)
// Rail 6 px, remplissage --amber animé 1 200 ms ease-out-expo, segments de
// niveau. Présentation pure contrôlée.

import { motion } from 'framer-motion';

interface XPBarProps {
  /** Progression courante dans le niveau. */
  value: number;
  /** Progression max du niveau. */
  max: number;
  /** Nombre de segments de niveau affichés (graduations). */
  segments?: number;
  label?: string;
  className?: string;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

export function XPBar({ value, max, segments = 10, label, className }: XPBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={className}>
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="font-hud text-[11px] font-semibold uppercase tracking-[0.2em] text-text-dim">
            {label}
          </span>
          <span className="font-mono text-[13px] text-text-hi">
            {Math.round(value)} / {max}
          </span>
        </div>
      )}
      <div className="relative h-[6px] bg-[rgba(127,168,201,0.12)]">
        <motion.div
          className="absolute inset-y-0 left-0 bg-amber"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.2, ease: EASE_OUT_EXPO }}
        />
        {/* Graduations de niveau */}
        {Array.from({ length: segments - 1 }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-abyss/80"
            style={{ left: `${((i + 1) / segments) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
