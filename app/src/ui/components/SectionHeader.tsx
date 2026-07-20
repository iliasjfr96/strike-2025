// STRIKE 2025 — <SectionHeader> (design.md §10, §4, §7.4)
// Kicker « /// TEXTE » (Rajdhani 600, 13 px, ls 0.30em, --steel) +
// titre Display L + séparateur §6. Entrée « Panel enter ».

import { motion } from 'framer-motion';

interface SectionHeaderProps {
  /** Texte du kicker (le préfixe « /// » est ajouté automatiquement). */
  kicker: string;
  title: string;
  className?: string;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

export function SectionHeader({ kicker, title, className }: SectionHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className={className}
    >
      <p className="font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-steel">
        /// {kicker}
      </p>
      <h2 className="mt-2 font-display text-[clamp(40px,4.5vw,64px)] font-semibold uppercase leading-[0.95] tracking-[0.05em] text-text-hi">
        {title}
      </h2>
      <div className="separator-tactical mt-4" aria-hidden="true" />
    </motion.div>
  );
}
