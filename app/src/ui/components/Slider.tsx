// STRIKE 2025 — <Slider> (design.md §10, menu.md E)
// Rail 2 px --line, graduation tous les 10 %, curseur losange 14 px --amber,
// valeur mono live à droite ; drag : curseur scale 1.2 (voir .slider-tactical
// dans index.css). Présentation pure contrôlée.

import type { CSSProperties, ReactNode } from 'react';

interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
  /** Appelé au relâchement (ex. blip de test du volume). */
  onCommit?(value: number): void;
  /** Formatage de la valeur mono affichée (défaut : brut arrondi au pas). */
  formatValue?(value: number): string;
  icon?: ReactNode;
  /** Sous-texte micro calculé live (ex. « MULTIPLICATEUR VISÉE : ×0.75 »). */
  subText?: string;
  className?: string;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  formatValue,
  icon,
  subText,
  className,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const shown = formatValue ? formatValue(value) : String(Math.round(value * 10) / 10);
  return (
    <div className={className}>
      {(label || icon) && (
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 font-hud text-[13px] font-semibold uppercase tracking-[0.18em] text-text-dim">
            {icon}
            {label}
          </span>
          <span className="font-mono text-[14px] text-text-hi">{shown}</span>
        </div>
      )}
      <input
        type="range"
        className="slider-tactical"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ '--fill': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
      <div className="slider-ticks mt-0.5" aria-hidden="true" />
      {subText && (
        <p className="mt-2 font-hud text-[11px] font-medium uppercase tracking-[0.22em] text-text-dim">
          {subText}
        </p>
      )}
    </div>
  );
}
