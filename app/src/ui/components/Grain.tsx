// STRIKE 2025 — <Grain> (design.md §10, §6 overlays)
// Texture bruit SVG feTurbulence (data-URI dans index.css), opacité 0.05,
// animée par steps(2) sur 800 ms — 2 frames alternées, pas de boucle
// coûteuse. pointer-events none.

interface GrainProps {
  className?: string;
}

export function Grain({ className }: GrainProps) {
  return (
    <div
      aria-hidden="true"
      className={`grain-overlay pointer-events-none absolute inset-0 ${className ?? ''}`}
    />
  );
}
