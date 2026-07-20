// ============================================================================
// STRIKE 2025 — Announcements.tsx (hud.md Module 4 — bannières d'annonces)
// Haut-centre sous le score, centrée 480 px. Une bannière à la fois (la plus
// récente), cycle §7.5 : drop 240 ms, maintien 2 400 ms, sortie 180 ms.
// Textes FR prêts fournis par le moteur (bridge.md §2 — Announcement).
// Champ store lu : announcements (max 3, purge > 4 s côté composant).
// ============================================================================

import { AnimatePresence } from 'framer-motion';
import { Info, RadioTower, Zap } from 'lucide-react';
import { useGameUI } from './store';
import { Banner } from './components';
import type { Announcement } from './store';
import { useNow } from './useNow';

const TTL_MS = 4000;

function toneOf(kind: Announcement['kind']): 'amber' | 'danger' | 'steel' {
  if (kind === 'streak') return 'amber';
  return 'steel'; // info / phase
}

function iconOf(kind: Announcement['kind']) {
  if (kind === 'streak') return <Zap size={18} strokeWidth={1.5} />;
  if (kind === 'phase') return <Info size={18} strokeWidth={1.5} />;
  return <RadioTower size={18} strokeWidth={1.5} />;
}

export default function Announcements() {
  const announcements = useGameUI((s) => s.announcements);
  const now = useNow(400);

  const live = announcements.filter((a) => now - a.at < TTL_MS);
  const current = live[live.length - 1];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[92px] z-30 flex justify-center">
      <AnimatePresence mode="wait">
        {current && (
          <Banner
            key={current.id}
            text={current.text}
            tone={toneOf(current.kind)}
            icon={iconOf(current.kind)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
