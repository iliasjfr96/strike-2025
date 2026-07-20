// STRIKE 2025 — <Countdown> (design.md §10, §7.9 countdown pulse)
// Chiffre Display XL mono ; à chaque seconde : scale 1.15 -> 1 + flash
// opacité, 300 ms (remonté par la clé React sur `value`).

interface CountdownProps {
  /** Valeur affichée (3, 2, 1… ou texte « GO »). */
  value: number | string;
  /** Micro-libellé sous le chiffre (ex. « INSERTION »). */
  label?: string;
  className?: string;
}

export function Countdown({ value, label, className }: CountdownProps) {
  return (
    <div className={`flex flex-col items-center ${className ?? ''}`} role="timer">
      <div
        key={String(value)}
        className="animate-countdown-pulse font-display text-[clamp(72px,9vw,150px)] font-bold uppercase leading-none tracking-[0.04em] text-text-hi [font-variant-numeric:tabular-nums]"
      >
        {value}
      </div>
      {label && (
        <div className="mt-2 font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-steel">
          {label}
        </div>
      )}
    </div>
  );
}
