// ============================================================================
// STRIKE 2025 — Crosshair.tsx (hud.md Module 1 — réticule dynamique)
// Point 2 px + 4 branches 2×10 px, gap de base 6 px + dispersion de l'arme
// (spread hip/ads depuis shared/weapons.ts) ; ADS -> repli à 2 px + opacité 1 ;
// tir (baisse d'ammoMag) -> +2 px retour élastique 120 ms ; sniper ADS ->
// réticule masqué, lunette plein écran (cercle + mil-dot).
// Champs store lus (bridge.md §2) : ads, ammoMag, weaponSlot, classId, phase.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameUI } from './store';
import { WEAPONS, weaponForSlot } from '../shared/weapons';

const BASE_GAP = 6;

/** Lunette du LR-50 : cercle plein écran, trait fin, mil-dot. */
function SniperScope() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className="pointer-events-none fixed inset-0 z-20"
      aria-hidden="true"
    >
      {/* Assombrissement hors-lunette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, transparent 0 31vmin, rgba(4,6,8,0.97) 33vmin)',
        }}
      />
      {/* Cercle de lunette */}
      <div className="absolute left-1/2 top-1/2 h-[64vmin] w-[64vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(234,240,245,0.5)]" />
      {/* Traits croisés */}
      <div className="absolute left-0 right-0 top-1/2 h-px bg-[rgba(234,240,245,0.6)]" />
      <div className="absolute bottom-0 left-1/2 top-0 w-px bg-[rgba(234,240,245,0.6)]" />
      {/* Mil-dots */}
      {[-3, -2, -1, 1, 2, 3].map((i) => (
        <span key={`h${i}`} className="absolute left-1/2 top-1/2 h-[3px] w-[3px] bg-text-hi" style={{ transform: `translate(calc(-50% + ${i * 48}px), -50%)` }} />
      ))}
      {[-3, -2, -1, 1, 2, 3].map((i) => (
        <span key={`v${i}`} className="absolute left-1/2 top-1/2 h-[3px] w-[3px] bg-text-hi" style={{ transform: `translate(-50%, calc(-50% + ${i * 48}px))` }} />
      ))}
    </motion.div>
  );
}

export default function Crosshair() {
  const ads = useGameUI((s) => s.ads);
  const ammoMag = useGameUI((s) => s.ammoMag);
  const weaponSlot = useGameUI((s) => s.weaponSlot);
  const classId = useGameUI((s) => s.classId);

  const weapon = WEAPONS[weaponForSlot(classId, weaponSlot)];
  const [shotBump, setShotBump] = useState(0);
  const prevMag = useRef(ammoMag);

  // Tir : le chargeur diminue -> +2 px, retour élastique géré par framer
  useEffect(() => {
    if (ammoMag < prevMag.current) {
      setShotBump(Date.now());
    }
    prevMag.current = ammoMag;
  }, [ammoMag]);

  const spreadDeg = weapon.spread.hip;
  const gap = BASE_GAP + spreadDeg * 2 + (shotBump ? 2 : 0);
  const opacity = 0.85;

  useEffect(() => {
    if (!shotBump) return;
    const t = window.setTimeout(() => setShotBump(0), 120);
    return () => window.clearTimeout(t);
  }, [shotBump]);

  // Visée (style BO2 console) : AUCUN réticule HUD — les organes de visée de
  // l'arme font foi. Le sniper garde son overlay de lunette plein écran.
  if (ads) {
    return weapon.id === 'lr50' ? <SniperScope /> : null;
  }

  // Branches animées par transform uniquement (perf, react-dev.md)
  const armTransition = { duration: shotBump ? 0.05 : 0.12, ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number] };

  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1], opacity: { duration: 0.08 } }}
      className="pointer-events-none fixed left-1/2 top-1/2 z-20"
      style={{ marginLeft: -24, marginTop: -24 }}
      aria-hidden="true"
    >
      <div className="relative h-12 w-12">
        {/* Point central 2 px */}
        <span className="absolute left-1/2 top-1/2 h-[2px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-text-hi" />
        {/* 4 branches (traits 2×10 px) écartées du gap via transform —
            centrage par marges (framer écrase les translate Tailwind) */}
        <motion.span
          animate={{ y: -gap - 10 }}
          transition={armTransition}
          className="absolute left-1/2 top-1/2 h-[10px] w-[2px] bg-text-hi"
          style={{ marginLeft: -1 }}
        />
        <motion.span
          animate={{ y: gap }}
          transition={armTransition}
          className="absolute left-1/2 top-1/2 h-[10px] w-[2px] bg-text-hi"
          style={{ marginLeft: -1 }}
        />
        <motion.span
          animate={{ x: -gap - 10 }}
          transition={armTransition}
          className="absolute left-1/2 top-1/2 h-[2px] w-[10px] bg-text-hi"
          style={{ marginTop: -1 }}
        />
        <motion.span
          animate={{ x: gap }}
          transition={armTransition}
          className="absolute left-1/2 top-1/2 h-[2px] w-[10px] bg-text-hi"
          style={{ marginTop: -1 }}
        />
      </div>
    </motion.div>
  );
}
