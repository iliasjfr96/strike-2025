// ============================================================================
// STRIKE 2025 — HUD.tsx (hud.md — conteneur d'overlay, z 20)
// Compose les 11 modules : réticule dynamique, hitmarkers + feed de points,
// bannières d'annonces, score + chrono, minimap radar + chip UAV, killfeed,
// santé, munitions, indicateurs de dégâts directionnels, vignette permanente
// + variante dégâts (throb §7.11 <= 30 PV), protection de spawn, mention de
// connexion. Le menu pause (Échap) est géré dans App.tsx.
// Lecture SEULE du store (bridge.md §2) : aucune action engine* ici.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import { useGameUI } from './store';
import { SPAWN_PROTECTION_S } from '../shared/protocol';
import Crosshair from './Crosshair';
import Hitmarker from './Hitmarker';
import DamageIndicator from './DamageIndicator';
import Announcements from './Announcements';
import ScoreStrip from './ScoreStrip';
import Minimap from './Minimap';
import StreakBar from './StreakBar';
import Killfeed from './Killfeed';
import HealthBar from './HealthBar';
import AmmoBlock from './AmmoBlock';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

export default function HUD() {
  const phase = useGameUI((s) => s.phase);
  const hp = useGameUI((s) => s.hp);
  const usePrompt = useGameUI((s) => s.usePrompt);
  const modeType = useGameUI((s) => s.modeType);
  const damageIndicators = useGameUI((s) => s.damageIndicators);
  const quality = useGameUI((s) => s.settings.quality);

  // Protection de spawn : 2 s après chaque retour en 'playing'
  const [protectUntil, setProtectUntil] = useState(0);
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (phase === 'playing' && prevPhase.current !== 'playing') {
      const until = Date.now() + SPAWN_PROTECTION_S * 1000;
      setProtectUntil(until);
      const t = window.setTimeout(() => setProtectUntil(0), SPAWN_PROTECTION_S * 1000 + 50);
      return () => window.clearTimeout(t);
    }
    prevPhase.current = phase;
  }, [phase]);
  const protectedNow = protectUntil > 0 && Date.now() < protectUntil;

  // Flash dégâts : dernière notification -> vignette rouge brève
  const lastDamage = damageIndicators[damageIndicators.length - 1];

  // Bannière d'ouverture de match (2 400 ms, une fois par montage)
  const [introBanner, setIntroBanner] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setIntroBanner(false), 2400);
    return () => window.clearTimeout(t);
  }, []);

  const lowHp = hp <= 30 && hp > 0;
  const decorative = quality !== 'low';

  if (phase === 'connecting') {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div className="chamfer-14 panel-surface px-8 py-6 text-center">
          <p className="font-hud text-[13px] font-semibold uppercase tracking-[0.3em] text-steel">
            /// CONNEXION AU SERVEUR…
          </p>
          <p className="mt-2 font-mono text-[13px] text-text-mid">
            SYNCHRONISATION EN COURS
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 select-none"
      style={{ cursor: 'none' }}
      aria-hidden="false"
    >
      {/* Vignette permanente (design.md §3) */}
      <div className="vignette-hud absolute inset-0" />

      {/* Vignette dégâts : brève à chaque coup + proportionnelle <= 30 PV */}
      <AnimatePresence>
        {lastDamage && (
          <motion.div
            key={lastDamage.id}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="vignette-danger absolute inset-0"
          />
        )}
      </AnimatePresence>
      {lowHp && (
        <div
          className="vignette-danger absolute inset-0"
          style={{
            opacity: 0.35,
            animation: decorative
              ? 'low-health-throb 900ms cubic-bezier(0.45,0,0.55,1) infinite'
              : undefined,
          }}
        />
      )}

      {/* Module 5 — Score & chrono (haut-centre) — seul module conservé
          (atténué 0.6) sur l'écran de mort (death.md §A) */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: phase === 'dead' ? 0.6 : 1, y: 0 }}
        transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      >
        <ScoreStrip />
      </motion.div>

      {phase !== 'dead' && (
        <>
          {/* Module 6 — Minimap radar + chip UAV (haut-gauche) */}
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.06, duration: 0.24, ease: EASE_OUT_EXPO }}
            className="absolute left-6 top-6 flex flex-col items-start gap-2"
          >
            <Minimap />
            <StreakBar />
          </motion.div>

          {/* Module 7 — Killfeed (haut-droite) */}
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.06, duration: 0.24, ease: EASE_OUT_EXPO }}
          >
            <Killfeed />
          </motion.div>

          {/* Module 1 — Réticule dynamique */}
          <Crosshair />
          {/* Module 2 — Hitmarkers + Module 3 — feed de points */}
          <Hitmarker />
          {/* Module 10 — Indicateurs de dégâts directionnels */}
          <DamageIndicator />
          {/* Module 4 — Bannières d'annonces */}
          <Announcements />

          {/* Module 8 — Santé (bas-gauche) */}
          <HealthBar />
          {/* Module 9 — Munitions & arme (bas-droite) */}
          <AmmoBlock />

          {/* Module 12 — Invite d'action E (R&D : poser / désamorcer) */}
          <AnimatePresence>
            {usePrompt && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
                className="chamfer-8 panel-surface absolute inset-x-0 bottom-[132px] z-30 mx-auto flex h-9 w-[340px] items-center justify-center"
              >
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-amber" />
                <span className="font-hud text-[12px] font-semibold uppercase tracking-[0.18em] text-amber">
                  {usePrompt}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Module 11 — Protection de spawn (sous le réticule) */}
      <AnimatePresence>
        {protectedNow && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="absolute left-1/2 top-1/2 flex translate-x-[-50%] items-center gap-2"
            style={{ marginTop: 44 }}
          >
            <Shield size={13} strokeWidth={1.5} className="text-steel" />
            <span className="font-hud text-[11px] font-semibold uppercase tracking-[0.22em] text-steel">
              PROTECTION ACTIVE — {SPAWN_PROTECTION_S} S
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bannière d'ouverture de match */}
      <AnimatePresence>
        {introBanner && phase === 'playing' && (
          <motion.div
            initial={{ y: 'calc(-100% - 8px)', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
            className="chamfer-8 panel-surface absolute inset-x-0 top-[148px] z-30 mx-auto flex h-10 w-[520px] items-center justify-center"
            role="status"
          >
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-amber" />
            <span className="font-display text-[20px] font-semibold uppercase tracking-[0.08em] text-text-hi">
              {modeType === 'dom'
                ? 'DOMINATION — CAPTUREZ ET TENEZ LES ZONES'
                : modeType === 'sad'
                  ? 'RECHERCHE & DESTRUCTION — POSEZ OU DÉFENDEZ'
                  : "MATCH À MORT PAR ÉQUIPE — ÉLIMINEZ L'ENNEMI"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
