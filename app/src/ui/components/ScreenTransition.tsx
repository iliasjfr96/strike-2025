// STRIKE 2025 — <ScreenTransition> (design.md §10, §2 flicker-wipe)
// Transition inter-écrans : flash blanc 60 ms -> coupe -> fondu entrant
// 420 ms + scanline descendante. Total ≈ 480 ms, easing ease-out-expo.
// Se déclenche à chaque changement de `trigger` (jamais au 1er montage).

import { useEffect, useRef, useState } from 'react';

interface ScreenTransitionProps {
  /** Clé de l'écran courant (ex. phase UI). Le wipe joue quand elle change. */
  trigger: string;
  className?: string;
}

const TOTAL_MS = 540;

export function ScreenTransition({ trigger, className }: ScreenTransitionProps) {
  const [active, setActive] = useState(false);
  const prevRef = useRef(trigger);

  useEffect(() => {
    if (prevRef.current === trigger) return;
    prevRef.current = trigger;
    setActive(true);
    const t = window.setTimeout(() => setActive(false), TOTAL_MS);
    return () => window.clearTimeout(t);
  }, [trigger]);

  if (!active) return null;

  return (
    <div aria-hidden="true" className={`pointer-events-none fixed inset-0 z-50 ${className ?? ''}`}>
      {/* Voile noir : opaque à la coupe, fondu entrant 420 ms (délai 60 ms) */}
      <div className="animate-wipe-cover absolute inset-0 bg-abyss" />
      {/* Flash blanc 60 ms */}
      <div className="animate-wipe-flash absolute inset-0 bg-white" />
      {/* Scanline descendante */}
      <div
        className="animate-wipe-scan absolute inset-x-0 top-0 h-[2px] bg-white/80 shadow-[0_0_16px_rgba(234,240,245,0.6)]"
        style={{ animationDelay: '60ms' }}
      />
    </div>
  );
}
