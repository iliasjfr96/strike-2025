// STRIKE 2025 — <Banner> (design.md §10, §7.5 banner drop)
// Barre fine 40 px pleine largeur ou centrée 480 px, fond --panel, icône +
// texte Saira C. 600 20 px, liseré couleur contexte. Entrée depuis le haut
// 240 ms ; sortie translateY(-8px) + fondu 180 ms (via AnimatePresence).

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export type BannerTone = 'amber' | 'danger' | 'steel';

interface BannerProps {
  text: string;
  icon?: ReactNode;
  tone?: BannerTone;
  /** Pleine largeur (défaut : centrée 480 px). */
  fullWidth?: boolean;
  className?: string;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const TONE_COLORS: Record<BannerTone, string> = {
  amber: 'var(--amber)',
  danger: 'var(--danger)',
  steel: 'var(--steel)',
};

export function Banner({ text, icon, tone = 'amber', fullWidth = false, className }: BannerProps) {
  const color = TONE_COLORS[tone];
  return (
    <motion.div
      initial={{ y: 'calc(-100% - 8px)', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -8, opacity: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO, exit: { duration: 0.18 } }}
      className={[
        'chamfer-8 panel-surface relative flex h-10 items-center justify-center gap-3 px-6',
        fullWidth ? 'w-full' : 'w-[480px]',
        className ?? '',
      ].join(' ')}
      role="status"
    >
      {/* Liseré couleur contexte */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      {icon && <span style={{ color }}>{icon}</span>}
      <span className="font-display text-[20px] font-semibold uppercase tracking-[0.08em] text-text-hi">
        {text}
      </span>
    </motion.div>
  );
}
