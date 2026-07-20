// STRIKE 2025 — <Panel> (design.md §10, §6 surfaces)
// Panneau standard glass (fond --panel + blur 12 px, bordure --line,
// liseré supérieur) + équerres d'angle en dépassement. Props `active`
// (fond --panel-raise, bordure forte, lueur) et `teamColor` (filet latéral
// 3 px couleur d'équipe + lueur assortie). Présentation pure.

import type { HTMLAttributes, ReactNode } from 'react';
import { CornerBrackets } from './CornerBrackets';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  active?: boolean;
  /** Couleur d'équipe / contexte du filet latéral (défaut : --amber). */
  teamColor?: string;
  /** Afficher les équerres d'angle (défaut true). */
  brackets?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({ active = false, teamColor, brackets = true, className, children, ...rest }: PanelProps) {
  return (
    <div
      className={[
        'chamfer-14 relative',
        active ? 'panel-surface-active' : 'panel-surface',
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {/* Filet latéral 3 px (panneau actif / couleur d'équipe) */}
      {(active || teamColor) && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{
            background: teamColor ?? 'var(--amber)',
            boxShadow: `0 0 24px ${teamColor ?? 'rgba(245,158,31,0.4)'}`,
          }}
        />
      )}
      {children}
      {brackets && <CornerBrackets />}
    </div>
  );
}
