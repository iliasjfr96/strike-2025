// STRIKE 2025 — useNow : horloge React légère pour les modules temps réel du
// HUD (chrono, reload, countdowns). Intervalle configurable ; nettoyage auto.

import { useEffect, useState } from 'react';

/** Retourne Date.now() rafraîchi toutes les `intervalMs` (défaut 250 ms). */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
