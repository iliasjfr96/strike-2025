/** @type {import('tailwindcss').Config} */
// STRIKE 2025 — tokens design.md §3 (couleurs via variables CSS),
// typographies §4, animations §7. Format ESM ("type": "module").
export default {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        abyss: 'var(--bg-abyss)',
        deep: 'var(--bg-deep)',
        panel: 'var(--panel)',
        'panel-solid': 'var(--panel-solid)',
        'panel-raise': 'var(--panel-raise)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        steel: 'var(--steel)',
        spectre: 'var(--spectre)',
        amber: 'var(--amber)',
        ravage: 'var(--ravage)',
        'text-hi': 'var(--text-hi)',
        'text-mid': 'var(--text-mid)',
        'text-dim': 'var(--text-dim)',
        danger: 'var(--danger)',
        ok: 'var(--ok)',
        'hit-kill': 'var(--hit-kill)',
      },
      fontFamily: {
        display: ['"Saira Condensed"', 'sans-serif'],
        hud: ['Rajdhani', 'sans-serif'],
        mono: ['"Share Tech Mono"', 'monospace'],
      },
      transitionDuration: {
        instant: '90ms',
        fast: '140ms',
        med: '240ms',
        slow: '480ms',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
        'in-out-quad': 'cubic-bezier(0.45, 0, 0.55, 1)',
      },
      keyframes: {
        // §7.1 — Boot flicker (arrivée sur un écran plein)
        'boot-flicker': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '27%': { opacity: '0.4' },
          '45%': { opacity: '0.1' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // §7.2 — Hover sweep (balayage lumineux 320 ms)
        sweep: {
          from: { transform: 'translateX(-130%) skewX(-15deg)' },
          to: { transform: 'translateX(230%) skewX(-15deg)' },
        },
        // §7.4 — Panel enter (12 px -> 0, 240 ms ease-out-expo)
        'panel-enter': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'panel-enter-x': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        // §7.5 — Banner drop (annonces en jeu)
        'banner-drop': {
          from: { opacity: '0', transform: 'translateY(calc(-100% - 8px))' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // §7.6 — Hitmarker pop (scale 1.5 -> 1 en 90 ms, fondu 260 ms)
        'hitmarker-pop': {
          '0%': { opacity: '1', transform: 'scale(1.5)' },
          '26%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(1)' },
        },
        // §7.7 — Killfeed slide (entrée 180 ms)
        'killfeed-slide': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        // §7.8 — Radar sweep (cône conique 360° en 3 s)
        'radar-sweep': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        // §7.9 — Countdown pulse (chaque seconde)
        'countdown-pulse': {
          '0%': { opacity: '0.35', transform: 'scale(1.15)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // §7.10 — Number tick (compteur mécanique)
        'number-tick-out': {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(-100%)' },
        },
        'number-tick-in': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        // §7.11 — Low-health throb (vignette rouge 900 ms)
        'low-health-throb': {
          '0%, 100%': { opacity: '0.2' },
          '50%': { opacity: '0.5' },
        },
        // §2/§7.12 — Flicker-wipe : flash blanc 60 ms
        'wipe-flash': {
          '0%': { opacity: '0' },
          '15%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        // §2 — Scanline descendante de transition (420 ms)
        'wipe-scan': {
          from: { transform: 'translateY(-8vh)' },
          to: { transform: 'translateY(108vh)' },
        },
        // §2 — Voile noir qui se dissipe après la coupe (420 ms)
        'wipe-cover': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        // Ken Burns lent du visuel de menu (menu.md — slow zoom idle)
        'ken-burns': {
          from: { transform: 'scale(1.02)' },
          to: { transform: 'scale(1.08)' },
        },
        // Grain §6 — 2 frames alternées en steps(2) sur 800 ms
        'grain-shift': {
          '0%': { transform: 'translate(0, 0)' },
          '50%': { transform: 'translate(-2%, 1.5%)' },
          '100%': { transform: 'translate(1.5%, -2%)' },
        },
        // Balayage vertical lent §6 (9 s)
        'sweep-light': {
          '0%': { transform: 'translateY(-15vh)' },
          '50%': { transform: 'translateY(110vh)' },
          '100%': { transform: 'translateY(-15vh)' },
        },
        // Halo logo — respiration 8 s (menu.md A)
        'halo-breath': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '0.55' },
        },
        // Chevrons JOUER — nudge 1 200 ms (menu.md B)
        'chevron-nudge-r': {
          '0%, 100%': { transform: 'translateX(0)', opacity: '0.6' },
          '50%': { transform: 'translateX(4px)', opacity: '1' },
        },
        'chevron-nudge-l': {
          '0%, 100%': { transform: 'translateX(0)', opacity: '0.6' },
          '50%': { transform: 'translateX(-4px)', opacity: '1' },
        },
        // Point EN LIGNE — pulsation 2 s (menu.md D)
        'online-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.8)' },
        },
        // Micro-secousse champ invalide (160 ms, menu.md B)
        'shake-x': {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-3px)' },
          '50%': { transform: 'translateX(3px)' },
          '75%': { transform: 'translateX(-3px)' },
        },
        // Scanline blanche du boot (400 ms linéaire, menu.md animations)
        'boot-scanline': {
          from: { transform: 'translateY(-4vh)' },
          to: { transform: 'translateY(104vh)' },
        },
        // Barre de statut — montée 240 ms (menu.md animations)
        'status-rise': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
      },
      animation: {
        'boot-flicker': 'boot-flicker 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        sweep: 'sweep 320ms cubic-bezier(0.25, 1, 0.5, 1)',
        'panel-enter': 'panel-enter 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'panel-enter-x': 'panel-enter-x 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'banner-drop': 'banner-drop 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'hitmarker-pop': 'hitmarker-pop 350ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'killfeed-slide': 'killfeed-slide 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'radar-sweep': 'radar-sweep 3s linear infinite',
        'countdown-pulse': 'countdown-pulse 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'number-tick-out': 'number-tick-out 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'number-tick-in': 'number-tick-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'low-health-throb': 'low-health-throb 900ms cubic-bezier(0.45, 0, 0.55, 1) infinite',
        'wipe-flash': 'wipe-flash 60ms linear both',
        'wipe-scan': 'wipe-scan 420ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'wipe-cover': 'wipe-cover 420ms cubic-bezier(0.16, 1, 0.3, 1) 60ms both',
        'ken-burns': 'ken-burns 26s ease-in-out infinite alternate',
        'grain-shift': 'grain-shift 800ms steps(2, jump-none) infinite',
        'sweep-light': 'sweep-light 9s cubic-bezier(0.45, 0, 0.55, 1) infinite',
        'halo-breath': 'halo-breath 8s cubic-bezier(0.45, 0, 0.55, 1) infinite',
        'chevron-nudge-r': 'chevron-nudge-r 1200ms cubic-bezier(0.45, 0, 0.55, 1) infinite',
        'chevron-nudge-l': 'chevron-nudge-l 1200ms cubic-bezier(0.45, 0, 0.55, 1) infinite',
        'online-pulse': 'online-pulse 2s cubic-bezier(0.45, 0, 0.55, 1) infinite',
        'shake-x': 'shake-x 160ms linear',
        'boot-scanline': 'boot-scanline 400ms linear both',
        'status-rise': 'status-rise 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
}
