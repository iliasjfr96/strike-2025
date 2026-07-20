// ============================================================================
// STRIKE 2025 — AmmoBlock.tsx (hud.md Module 9 — munitions & arme bas-droit)
// Chargeur Saira C. 700 44 px + réserve mono « ╱ 90 » ; nom d'arme dessous ;
// jauge fine 120 px (danger < 25 %) ; équipement à gauche (flash, P9 — [2]).
// Rechargement : « RECHARGEMENT » ambre + arc circulaire 28 px (progression
// depuis reloadEndsAt / durée arme) ; chargeur vide : « 0 » danger clignotant
// + hint « R — RECHARGER » ; micro-tick du chiffre à chaque tir.
// Champs store lus (bridge.md §2) : ammoMag, ammoReserve, weaponSlot,
// reloading, reloadEndsAt, classId.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { useGameUI } from './store';
import { WEAPONS, weaponForSlot } from '../shared/weapons';
import { useNow } from './useNow';

const RING_R = 12;
const RING_C = 2 * Math.PI * RING_R;

export default function AmmoBlock() {
  const ammoMag = useGameUI((s) => s.ammoMag);
  const ammoReserve = useGameUI((s) => s.ammoReserve);
  const weaponSlot = useGameUI((s) => s.weaponSlot);
  const reloading = useGameUI((s) => s.reloading);
  const reloadEndsAt = useGameUI((s) => s.reloadEndsAt);
  const classId = useGameUI((s) => s.classId);
  const now = useNow(50);

  const weapon = WEAPONS[weaponForSlot(classId, weaponSlot)];
  const [tick, setTick] = useState(0);
  const prevMag = useRef(ammoMag);

  // Micro-tick du chargeur à chaque tir (translateY -2 px, 60 ms)
  useEffect(() => {
    if (ammoMag < prevMag.current) setTick(Date.now());
    prevMag.current = ammoMag;
  }, [ammoMag]);
  useEffect(() => {
    if (!tick) return;
    const t = window.setTimeout(() => setTick(0), 60);
    return () => window.clearTimeout(t);
  }, [tick]);

  const empty = ammoMag === 0 && !reloading;
  const lowMag = ammoMag / weapon.magSize < 0.25;

  // Progression du rechargement (arc circulaire)
  const reloadTotal = weapon.reloadMs;
  const reloadRemaining = reloading && reloadEndsAt > 0 ? Math.max(0, reloadEndsAt - now) : 0;
  const reloadPct = reloading ? 1 - reloadRemaining / reloadTotal : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-none absolute bottom-6 right-6 z-20 flex items-end gap-5"
      style={{ contain: 'layout style' }}
      aria-label={`Munitions ${ammoMag} sur ${ammoReserve}`}
      role="status"
    >
      {/* Équipement (gauche du bloc) */}
      <div className="mb-1 flex flex-col items-end gap-1.5">
        <span className="chamfer-6 flex items-center gap-1.5 border border-line px-2 py-1 font-hud text-[11px] font-semibold uppercase tracking-[0.14em] text-text-dim">
          <Zap size={11} strokeWidth={1.5} />
          FLASH ×1
        </span>
        <span className="chamfer-6 flex items-center gap-1.5 border border-line px-2 py-1 font-hud text-[11px] font-semibold uppercase tracking-[0.14em] text-text-dim">
          P9 — [2]
        </span>
      </div>

      <div className="flex flex-col items-end">
        {reloading ? (
          <div className="flex h-[52px] items-center gap-3">
            {/* Arc de progression circulaire 28 px */}
            <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden="true">
              <circle cx={14} cy={14} r={RING_R} fill="none" stroke="rgba(127,168,201,0.15)" strokeWidth={2} />
              <circle
                cx={14}
                cy={14}
                r={RING_R}
                fill="none"
                stroke="var(--amber)"
                strokeWidth={2}
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - reloadPct)}
                transform="rotate(-90 14 14)"
              />
            </svg>
            <span className="font-hud text-[13px] font-semibold uppercase tracking-[0.18em] text-amber">
              RECHARGEMENT
            </span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <motion.span
              animate={tick ? { y: -2 } : { y: 0 }}
              transition={{ duration: 0.06 }}
              className="font-display text-[44px] font-bold leading-none [font-variant-numeric:tabular-nums]"
              style={{
                color: empty ? 'var(--danger)' : 'var(--text-hi)',
                animation: empty ? 'low-health-throb 500ms cubic-bezier(0.45,0,0.55,1) infinite' : undefined,
              }}
            >
              {ammoMag}
            </motion.span>
            <span className="font-mono text-[22px] text-text-mid [font-variant-numeric:tabular-nums]">
              ╱ {ammoReserve}
            </span>
          </div>
        )}

        {/* Jauge fine 120 px du chargeur */}
        <div className="mt-1 h-[3px] w-[120px] bg-[rgba(127,168,201,0.12)]" aria-hidden="true">
          <div
            className="h-full transition-[width] duration-fast"
            style={{
              width: `${Math.min(100, (ammoMag / weapon.magSize) * 100)}%`,
              background: lowMag ? 'var(--danger)' : 'var(--steel)',
            }}
          />
        </div>

        <p className="mt-1.5 font-hud text-[13px] font-semibold uppercase tracking-[0.18em] text-text-dim">
          {weapon.name} — {weapon.auto ? 'AUTO' : weapon.id === 'p9' ? 'SEMI' : 'VERROU'}
        </p>
        {empty && (
          <p className="mt-0.5 font-hud text-[11px] font-semibold uppercase tracking-[0.22em] text-amber">
            R — RECHARGER
          </p>
        )}
      </div>
    </motion.div>
  );
}
