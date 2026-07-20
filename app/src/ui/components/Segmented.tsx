// STRIKE 2025 — <Segmented> (design.md §10)
// Groupe de chips chanfreinées ; sélection = fond --amber texte sombre ;
// transition fond 140 ms. Présentation pure contrôlée.

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Libellé d'accessibilité du groupe. */
  ariaLabel?: string;
  className?: string;
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`flex gap-1 ${className ?? ''}`}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={[
              'chamfer-8 h-9 flex-1 px-4 font-hud text-[13px] font-semibold uppercase tracking-[0.18em]',
              'transition-colors duration-fast ease-out-quart',
              selected
                ? 'bg-amber text-[#0A0F14]'
                : 'border border-line text-text-mid hover:border-line-strong hover:text-text-hi',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
