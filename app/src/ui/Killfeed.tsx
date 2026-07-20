// ============================================================================
// STRIKE 2025 — Killfeed.tsx (hud.md Module 7)
// Pile verticale haut-droite (16 px haut / 24 px droit, gap 6 px, max 5
// entrées). Entrées <KillfeedEntry> (§10) ; victime alliée -> liseré danger
// gauche ; implication du joueur -> fond renforcé ambre/danger. Cycle §7.7 :
// slide 180 ms, vie 4 500 ms, fondu 200 ms, remontée 200 ms.
// Champs store lus (bridge.md §2) : killfeed, pseudo, myTeam.
// ============================================================================

import { AnimatePresence, motion } from 'framer-motion';
import { useGameUI } from './store';
import { KillfeedEntry } from './components';
import { useNow } from './useNow';

const TTL_MS = 4500;
const MAX_ENTRIES = 5;

export default function Killfeed() {
  const killfeed = useGameUI((s) => s.killfeed);
  const pseudo = useGameUI((s) => s.pseudo);
  const myTeam = useGameUI((s) => s.myTeam);
  const now = useNow(500);

  const live = killfeed.filter((e) => now - e.at < TTL_MS).slice(-MAX_ENTRIES);

  return (
    <div
      className="pointer-events-none absolute right-6 top-4 z-20 flex flex-col items-end gap-1.5"
      aria-label="Killfeed"
    >
      <AnimatePresence initial={false}>
        {live.map((e) => {
          const mine = e.killerName === pseudo;
          const myDeath = e.victimName === pseudo;
          const allyDown = myTeam !== null && e.victimTeam === myTeam && !myDeath;
          return (
            <motion.div
              key={e.id}
              layout="position"
              transition={{ layout: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
              className="relative"
            >
              {allyDown && (
                <span aria-hidden="true" className="absolute inset-y-0 left-0 z-10 w-[2px] bg-danger" />
              )}
              <KillfeedEntry
                killerName={e.killerName}
                victimName={e.victimName}
                killerTeam={e.killerTeam}
                victimTeam={e.victimTeam}
                weapon={e.weapon}
                head={e.head}
                className={
                  mine
                    ? 'bg-[rgba(245,158,31,0.12)]'
                    : myDeath
                      ? 'bg-[rgba(229,72,77,0.14)]'
                      : undefined
                }
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
