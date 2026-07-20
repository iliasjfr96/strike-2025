// STRIKE 2025 — <Scanlines> (design.md §10, §6 overlays)
// Scanlines plein écran : repeating-linear-gradient 1 px / 3 px, opacité
// 0.35, mix-blend overlay. pointer-events none. Couper en reduced-motion
// (géré dans index.css).

interface ScanlinesProps {
  className?: string;
}

export function Scanlines({ className }: ScanlinesProps) {
  return (
    <div
      aria-hidden="true"
      className={`scanlines-overlay pointer-events-none absolute inset-0 ${className ?? ''}`}
    />
  );
}
