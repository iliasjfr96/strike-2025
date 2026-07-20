// STRIKE 2025 — <KillfeedEntry> (design.md §10, §7.7 killfeed slide)
// Ligne 28 px : pseudo A (couleur équipe) + icône arme SVG 16 px + pseudo B ;
// fond rgba(6,9,12,0.65) chanfrein 6 px. Entrée translateX(24px) 180 ms ;
// sortie fondu 200 ms (via AnimatePresence dans <Killfeed>).

import { motion } from 'framer-motion';
import type { TeamId, WeaponId } from '../../shared/protocol';
import { teamColorVar, truncateName } from './TeamTag';

export interface KillfeedEntryProps {
  killerName: string;
  victimName: string;
  killerTeam: TeamId;
  victimTeam: TeamId;
  weapon: WeaponId;
  head?: boolean;
  className?: string;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

/** Picto d'arme du sprite public/weapon-icons.svg (silhouette 1 couleur). */
export function WeaponIcon({ weapon, className }: { weapon: WeaponId; className?: string }) {
  return (
    <svg className={className ?? 'h-4 w-4'} aria-hidden="true">
      <use href={`/weapon-icons.svg#icon-${weapon.startsWith('custom') ? 'vsk27' : weapon}`} />
    </svg>
  );
}

export function KillfeedEntry({
  killerName,
  victimName,
  killerTeam,
  victimTeam,
  weapon,
  head = false,
  className,
}: KillfeedEntryProps) {
  return (
    <motion.div
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
      className={[
        'chamfer-6 flex h-7 items-center gap-2 bg-[rgba(6,9,12,0.65)] px-2.5',
        className ?? '',
      ].join(' ')}
    >
      <span className="font-hud text-[14px] font-semibold" style={{ color: teamColorVar(killerTeam) }}>
        {truncateName(killerName)}
      </span>
      <span className="text-text-mid">
        <WeaponIcon weapon={weapon} />
      </span>
      {head && (
        <svg className="h-3.5 w-3.5 text-hit-kill" aria-label="Tir à la tête" role="img">
          <use href="/weapon-icons.svg#icon-headshot" />
        </svg>
      )}
      <span className="font-hud text-[14px] font-semibold" style={{ color: teamColorVar(victimTeam) }}>
        {truncateName(victimName)}
      </span>
    </motion.div>
  );
}
