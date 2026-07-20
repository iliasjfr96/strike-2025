// STRIKE 2025 — <TacticalButton> (design.md §10, §7.2 sweep, §7.3 press)
// Chanfrein 8 px (16 px variante hero). Variantes primary / ghost / danger.
// Hauteur 44 px (hero 64 px), padding-x 24/48 px, hover 90 ms, disabled
// opacité 0.35 + curseur barré. Présentation pure.

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type TacticalButtonVariant = 'primary' | 'ghost' | 'danger';

interface TacticalButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TacticalButtonVariant;
  /** Variante héros (JOUER) : 64 px, chanfrein 16 px TL/BR, px 48. */
  hero?: boolean;
  icon?: ReactNode;
}

const VARIANT_CLASSES: Record<TacticalButtonVariant, string> = {
  primary:
    'bg-amber text-[#0A0F14] font-display font-bold uppercase tracking-[0.12em] ' +
    'hover:bg-[#FFB84D] hover:shadow-[0_0_24px_rgba(245,158,31,0.25)]',
  ghost:
    'bg-transparent border border-line text-text-hi font-hud font-semibold uppercase tracking-[0.14em] ' +
    'hover:border-line-strong',
  danger:
    'bg-transparent border border-danger text-danger font-hud font-semibold uppercase tracking-[0.14em] ' +
    'hover:bg-danger/10',
};

export function TacticalButton({
  variant = 'ghost',
  hero = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: TacticalButtonProps) {
  const sizing = hero ? 'h-16 px-12 text-[26px] tracking-[0.14em]' : 'h-11 px-6 text-[15px]';
  const chamfer = hero ? 'chamfer-hero' : 'chamfer-8';
  return (
    <button
      type={type}
      disabled={disabled}
      className={[
        'group relative inline-flex select-none items-center justify-center gap-2',
        'transition-[background-color,border-color,box-shadow,transform,filter] duration-instant ease-out-quart',
        'active:scale-[0.98] active:brightness-[0.92]',
        'disabled:pointer-events-none disabled:opacity-35',
        sizing,
        chamfer,
        VARIANT_CLASSES[variant],
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {/* §7.2 — hover sweep : balayage lumineux 320 ms */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -translate-x-[130%] bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:animate-sweep"
      />
      {icon}
      <span className="relative">{children}</span>
    </button>
  );
}
