// ============================================================================
// STRIKE 2025 — App.tsx
// Racine du jeu : hôte canvas 3D TOUJOURS monté (z 0, consommé par le moteur
// via initGameClient) + écran actif selon useGameUI.phase (bridge.md §4) :
//   menu -> MainMenu · loadout -> LoadoutScreen · connecting/playing -> HUD
//   dead   -> HUD + DeathScreen (overlay) · end -> EndScreen
// Overlays par-dessus le jeu : Scoreboard (Tab maintenu, match uniquement) et
// PauseMenu (Échap, match uniquement). Transition flicker-wipe (design.md §2)
// uniquement entre les écrans pleins — jamais sur les overlays in-match.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AnimatePresence } from 'framer-motion';
import { initGameClient } from './game/instance';
import { useGameUI } from './ui/store';
import type { UIPhase } from './ui/store';
import { ScreenTransition } from './ui/components';
import MainMenu from './pages/MainMenu';
import LoadoutScreen from './pages/LoadoutScreen';
import MapEditorScreen from './pages/MapEditorScreen';
import CommunityScreen from './pages/CommunityScreen';
import AdminScreen from './pages/AdminScreen';
import EndScreen from './pages/EndScreen';
import HUD from './ui/HUD';
import Scoreboard from './ui/Scoreboard';
import DeathScreen from './ui/DeathScreen';
import PauseMenu from './ui/PauseMenu';

/** Phases qui déclenchent le flicker-wipe (écrans pleins, pas overlays). */
const WIPE_PHASES: readonly UIPhase[] = ['menu', 'loadout', 'playing', 'end', 'editor', 'community', 'admin'];

function GameRoot() {
  const phase = useGameUI((s) => s.phase);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);

  // Le moteur (AGENT MOTEUR) s'initialise une fois le canvas monté.
  useEffect(() => {
    if (canvasRef.current) {
      initGameClient(canvasRef.current);
    }
  }, []);

  const inMatch = phase === 'playing' || phase === 'dead' || phase === 'connecting';

  // Overlays clavier en match : Tab maintenu -> scoreboard (apparition
  // immédiate <= 140 ms) ; Échap -> menu pause. Hors match : tout fermé, la
  // navigation clavier des menus n'est jamais interceptée.
  useEffect(() => {
    if (!inMatch) {
      setScoreboardOpen(false);
      setPauseOpen(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setScoreboardOpen(true);
      } else if (e.key === 'Escape') {
        setScoreboardOpen(false);
        setPauseOpen((v) => !v);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setScoreboardOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [inMatch]);

  const wipeKey = WIPE_PHASES.includes(phase) ? phase : 'in-match';

  return (
    <div className="relative h-full w-full overflow-hidden bg-abyss">
      {/* Hôte canvas 3D — toujours monté, ref consommée par le moteur */}
      <div id="game-canvas-host" className="absolute inset-0 z-0">
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
      </div>

      {/* Écrans pleins selon la phase UI */}
      {phase === 'menu' && <MainMenu />}
      {phase === 'loadout' && <LoadoutScreen />}
      {phase === 'editor' && <MapEditorScreen />}
      {phase === 'community' && <CommunityScreen />}
      {phase === 'admin' && <AdminScreen />}
      {inMatch && <HUD />}
      {phase === 'end' && <EndScreen />}

      {/* Overlays in-match (apparition immédiate, pas de wipe) */}
      <AnimatePresence>{phase === 'dead' && <DeathScreen key="death" />}</AnimatePresence>
      <AnimatePresence>
        {inMatch && scoreboardOpen && !pauseOpen && <Scoreboard key="scoreboard" />}
      </AnimatePresence>
      <AnimatePresence>
        {inMatch && pauseOpen && <PauseMenu key="pause" onResume={() => setPauseOpen(false)} />}
      </AnimatePresence>

      {/* Transition flicker-wipe entre écrans pleins (z 50) */}
      <ScreenTransition trigger={wipeKey} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GameRoot />} />
      </Routes>
    </BrowserRouter>
  );
}
