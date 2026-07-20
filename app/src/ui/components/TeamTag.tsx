// STRIKE 2025 — <TeamTag> (design.md §10, §4 pseudos)
// Pastille 6 px couleur d'équipe + pseudo coloré ; variante `dead`
// barrée/atténuée. Pseudos tronqués à 14 caractères (« … »).

import type { TeamId } from '../../shared/protocol';

interface TeamTagProps {
  name: string;
  team: TeamId;
  dead?: boolean;
  className?: string;
}

/** Tronque un pseudo à 14 caractères (règle typographique §4). */
export function truncateName(name: string, max = 14): string {
  return name.length > max ? `${name.slice(0, max)}…` : name;
}

export function teamColorVar(team: TeamId): string {
  return team === 0 ? 'var(--spectre)' : 'var(--ravage)';
}

export function TeamTag({ name, team, dead = false, className }: TeamTagProps) {
  const color = teamColorVar(team);
  return (
    <span
      className={`inline-flex items-center gap-2 ${dead ? 'opacity-50' : ''} ${className ?? ''}`}
    >
      <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0" style={{ background: color }} />
      <span
        className={`font-hud text-[14px] font-semibold ${dead ? 'line-through' : ''}`}
        style={{ color }}
      >
        {truncateName(name)}
      </span>
    </span>
  );
}
