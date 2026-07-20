// STRIKE 2025 — <SweepLight> (design.md §10, §6 overlays)
// Balayage vertical lent : bande lumineuse 120 px traversant l'écran en
// 9 s, boucle infinie, ease-in-out. pointer-events none. Coupée en
// reduced-motion (géré dans index.css).

interface SweepLightProps {
  className?: string;
}

export function SweepLight({ className }: SweepLightProps) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`}>
      <div className="sweep-light-band animate-sweep-light absolute inset-x-0 top-0" />
    </div>
  );
}
