// ============================================================================
// STRIKE 2025 — HealthBar.tsx (hud.md Module 8 — santé bas-gauche)
// Icône heart-pulse 18 px + valeur Saira C. 700 40 px + barre 10 segments
// (16×6 px, 200 px). États : 100-61 blanc · 60-31 ambre · <= 30 danger +
// pulsation §7.11 (la vignette rouge plein écran vit dans HUD.tsx). Régén
// visible : remplissage animé 400 ms + sous-label « RÉGÉNÉRATION AUTO ».
// Champ store lu (bridge.md §2) : hp.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { HeartPulse } from 'lucide-react';
import { useGameUI } from './store';

const SEGMENTS = 10;

export default function HealthBar() {
  const hp = useGameUI((s) => s.hp);
  const prevHp = useRef(hp);
  const [regen, setRegen] = useState(false);

  useEffect(() => {
    if (hp > prevHp.current && hp < 100) setRegen(true);
    if (hp >= 100) setRegen(false);
    prevHp.current = hp;
  }, [hp]);

  const clamped = Math.max(0, Math.min(100, hp));
  const color =
    clamped <= 30 ? 'var(--danger)' : clamped <= 60 ? 'var(--amber)' : 'var(--text-hi)';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-none absolute bottom-6 left-6 z-20"
      style={{ contain: 'layout style' }}
      aria-label={`Santé ${clamped}`}
      role="status"
    >
      <div className="flex items-end gap-3">
        <span style={{ color }} className="mb-2">
          <HeartPulse size={18} strokeWidth={1.5} />
        </span>
        <span
          className="font-display text-[40px] font-bold leading-none [font-variant-numeric:tabular-nums]"
          style={{
            color,
            animation:
              clamped <= 30 && clamped > 0
                ? 'low-health-throb 900ms cubic-bezier(0.45,0,0.55,1) infinite'
                : undefined,
          }}
        >
          {clamped}
        </span>
        {/* Barre segmentée 10 × (16×6) */}
        <div className="mb-2 flex gap-[3.5px]" aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, i) => {
            const on = i < Math.ceil(clamped / 10);
            return (
              <motion.span
                key={i}
                animate={{
                  background: on ? color : 'rgba(127,168,201,0.12)',
                }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="h-[6px] w-[16px]"
              />
            );
          })}
        </div>
      </div>
      {regen && (
        <p className="mt-1 font-hud text-[10px] font-semibold uppercase tracking-[0.22em] text-steel">
          RÉGÉNÉRATION AUTO<span className="animate-pulse">…</span>
        </p>
      )}
    </motion.div>
  );
}
