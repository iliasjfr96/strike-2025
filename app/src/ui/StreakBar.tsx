// ============================================================================
// STRIKE 2025 — StreakBar.tsx (hud.md Module 6 — chip UAV 180×36 px)
// Sous le radar : icône radio-tower + « UAV » + jauge 4 segments.
// États : EN CHARGE… (grisé, % mono, points 0->400) -> PRÊT — [4] (ambre,
// pulse 900 ms) -> ACTIF — 0:30 (acier, compte à rebours, ennemis révélés).
// Champs store lus (bridge.md §2) : streakPoints, uavActiveUntil,
// serverOffsetMs. Action : touche « 4 » -> gameClient.activateStreak().
// ============================================================================

import { RadioTower } from 'lucide-react';
import { useGameUI } from './store';
import { UAV_COST } from '../shared/protocol';
import { useNow } from './useNow';

const SEGMENTS = 4;

export default function StreakBar() {
  const streakPoints = useGameUI((s) => s.streakPoints);
  const uavActiveUntil = useGameUI((s) => s.uavActiveUntil);
  const serverOffsetMs = useGameUI((s) => s.serverOffsetMs);
  const now = useNow(250);

  const activeRemainingMs = uavActiveUntil > 0 ? uavActiveUntil - serverOffsetMs - now : 0;
  const active = activeRemainingMs > 0;
  const ready = !active && streakPoints >= UAV_COST;

  const pct = Math.min(100, Math.round((streakPoints / UAV_COST) * 100));
  const filled = Math.min(SEGMENTS, Math.floor((streakPoints / UAV_COST) * SEGMENTS));

  let label: string;
  let color: string;
  if (active) {
    const s = Math.ceil(activeRemainingMs / 1000);
    label = `ACTIF — 0:${String(s).padStart(2, '0')}`;
    color = 'var(--spectre)';
  } else if (ready) {
    label = 'PRÊT — [4]';
    color = 'var(--amber)';
  } else {
    label = 'EN CHARGE…';
    color = 'var(--text-dim)';
  }

  return (
    <div
      className="chamfer-8 panel-surface relative flex h-9 w-[180px] items-center gap-2 px-2.5"
      role="status"
      aria-label={`UAV ${label}`}
      style={ready ? { animation: 'low-health-throb 900ms cubic-bezier(0.45,0,0.55,1) infinite' } : undefined}
    >
      <span style={{ color }}>
        <RadioTower size={14} strokeWidth={1.5} />
      </span>
      <span className="font-hud text-[13px] font-semibold uppercase tracking-[0.14em]" style={{ color }}>
        UAV
      </span>
      {/* Jauge 4 segments */}
      <span className="flex gap-[3px]" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className="h-[10px] w-[10px]"
            style={{
              background:
                active || ready
                  ? color
                  : i < filled
                    ? 'var(--steel)'
                    : 'rgba(127,168,201,0.12)',
            }}
          />
        ))}
      </span>
      <span className="ml-auto font-mono text-[11px]" style={{ color }}>
        {active || ready ? label : `${label} ${pct}%`}
      </span>
    </div>
  );
}
