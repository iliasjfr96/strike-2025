// ============================================================================
// STRIKE 2025 — PauseMenu.tsx (hud.md — Interactions : Échap)
// Panneau centré 360 px : REPRENDRE / PARAMÈTRES (mêmes contrôles que
// menu.md §E : sensibilité, FOV, volume, qualité) / QUITTER LE MATCH
// (danger, confirmation inline -> gameClient.disconnect() -> menu).
// Le jeu continue derrière : backdrop assombri + blur, jeu visible.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pause, Settings, Volume2, VolumeX, X } from 'lucide-react';
import { useGameUI } from './store';
import type { QualityLevel } from './store';
import { gameClient } from '../game/instance';
import { Panel, SectionHeader, Segmented, Slider, TacticalButton } from './components';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const QUALITY_OPTIONS: { value: QualityLevel; label: string }[] = [
  { value: 'low', label: 'FAIBLE' },
  { value: 'medium', label: 'MOYEN' },
  { value: 'high', label: 'ÉLEVÉ' },
  { value: 'ultra', label: 'ULTRA' },
];

interface PauseMenuProps {
  onResume: () => void;
}

export default function PauseMenu({ onResume }: PauseMenuProps) {
  const settings = useGameUI((s) => s.settings);
  const setSettings = useGameUI((s) => s.setSettings);
  const backToMenu = useGameUI((s) => s.backToMenu);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const quitTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (quitTimer.current) window.clearTimeout(quitTimer.current);
    },
    [],
  );

  const quit = () => {
    if (!confirmQuit) {
      setConfirmQuit(true);
      quitTimer.current = window.setTimeout(() => setConfirmQuit(false), 2500);
      return;
    }
    gameClient.disconnect();
    backToMenu();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.14 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(4,6,8,0.6)] backdrop-blur-[6px]"
      role="dialog"
      aria-label="Menu pause"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.14, ease: EASE_OUT_EXPO }}
      >
        <Panel className="w-[360px] p-6">
          <div className="flex items-center gap-3">
            <Pause size={18} strokeWidth={1.5} className="text-steel" />
            <h2 className="font-display text-[26px] font-semibold uppercase tracking-[0.06em] text-text-hi">
              PAUSE
            </h2>
          </div>
          <p className="mt-1 font-hud text-[11px] font-medium uppercase tracking-[0.22em] text-text-dim">
            LE MATCH CONTINUE — VOUS RESTEZ VULNÉRABLE
          </p>

          <div className="mt-5 flex flex-col gap-3">
            <TacticalButton variant="primary" onClick={onResume} className="w-full">
              REPRENDRE
            </TacticalButton>
            <TacticalButton
              variant="ghost"
              icon={<Settings size={16} strokeWidth={1.5} />}
              onClick={() => setSettingsOpen((v) => !v)}
              className="w-full"
            >
              PARAMÈTRES
            </TacticalButton>

            <AnimatePresence>
              {settingsOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col gap-5 border-t border-line pt-5">
                    <Slider
                      label="SENSIBILITÉ SOURIS"
                      min={0.1}
                      max={10}
                      step={0.1}
                      value={settings.sensitivity}
                      onChange={(v) => setSettings({ sensitivity: v })}
                      formatValue={(v) => v.toFixed(1)}
                    />
                    <Slider
                      label="CHAMP DE VISION (FOV)"
                      min={70}
                      max={110}
                      step={1}
                      value={settings.fov}
                      onChange={(v) => setSettings({ fov: v })}
                    />
                    <Slider
                      label="VOLUME PRINCIPAL"
                      min={0}
                      max={100}
                      step={1}
                      value={settings.volume}
                      onChange={(v) => setSettings({ volume: v })}
                      icon={
                        settings.volume === 0 || settings.muted ? (
                          <VolumeX size={16} strokeWidth={1.5} />
                        ) : (
                          <Volume2 size={16} strokeWidth={1.5} />
                        )
                      }
                    />
                    <div>
                      <p className="mb-2 font-hud text-[13px] font-semibold uppercase tracking-[0.18em] text-text-dim">
                        QUALITÉ GRAPHIQUE
                      </p>
                      <Segmented
                        ariaLabel="Qualité graphique"
                        options={QUALITY_OPTIONS}
                        value={settings.quality}
                        onChange={(q) => setSettings({ quality: q })}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <TacticalButton variant="danger" onClick={quit} className="w-full">
              {confirmQuit ? 'CONFIRMER : QUITTER ?' : 'QUITTER LE MATCH'}
            </TacticalButton>
          </div>

          <p className="mt-4 flex items-center gap-2 font-hud text-[10px] font-medium uppercase tracking-[0.22em] text-text-dim">
            <X size={11} strokeWidth={1.5} />
            ÉCHAP POUR REPRENDRE
          </p>
        </Panel>
      </motion.div>
    </motion.div>
  );
}
