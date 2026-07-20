// STRIKE 2025 — <StatBar> (design.md §10)
// 10 segments 4×14 px espacés de 3 px ; remplis --amber (défaut) ou --steel,
// vides rgba(127,168,201,0.12) ; remplissage stagger 30 ms/segment à
// l'affichage ; label Rajdhani 600 11 px ls 0.2em + valeur mono à droite.

import { motion } from 'framer-motion';

interface StatBarProps {
  label: string;
  /** Valeur courante (0..max). */
  value: number;
  max?: number;
  tone?: 'amber' | 'steel';
  /** Texte affiché à droite (défaut : valeur arrondie). */
  displayValue?: string;
  className?: string;
}

const SEGMENTS = 10;

export function StatBar({ label, value, max = 100, tone = 'amber', displayValue, className }: StatBarProps) {
  const filled = Math.round((Math.min(Math.max(value, 0), max) / max) * SEGMENTS);
  const fillColor = tone === 'amber' ? 'var(--amber)' : 'var(--steel)';
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-hud text-[11px] font-semibold uppercase tracking-[0.2em] text-text-dim">
          {label}
        </span>
        <span className="font-mono text-[13px] text-text-hi">
          {displayValue ?? String(Math.round(value))}
        </span>
      </div>
      <div className="flex gap-[3px]" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, scaleY: 0.3 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ delay: i * 0.03, duration: 0.18, ease: 'easeOut' }}
            className="h-[14px] w-1 origin-bottom"
            style={{
              background: i < filled ? fillColor : 'rgba(127,168,201,0.12)',
            }}
          />
        ))}
      </div>
    </div>
  );
}
