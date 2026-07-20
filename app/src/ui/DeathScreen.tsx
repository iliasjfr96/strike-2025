// ============================================================================
// STRIKE 2025 — DeathScreen.tsx (death.md — écran de mort / killcam, z 40)
// Traitement global : désaturation du monde (backdrop-filter), letterbox
// 64 px, flash danger initial, grain renforcé. Phase KILLCAM (chrome REC +
// timestamp image-par-image + filet de lecture + marqueur VOUS ; le replay
// 3D est rendu par le moteur — /killcam-frame.png en fallback hors connexion)
// puis phase ATTENTE (« VOUS ÊTES HORS COMBAT »). Carte du tueur (pseudo,
// arme, emblème), compte à rebours de réapparition en anneau, [C] changement
// de classe (grille compacte -> gameClient.setLoadout, bridge.md §3).
// Champs store lus (bridge.md §2) : killcam, players, myTeam, scores,
// classId, connected, pseudo.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Skull } from 'lucide-react';
import { useGameUI } from './store';
import type { ClassId, WeaponId } from '../shared/protocol';
import { KILLCAM_DURATION_S, RESPAWN_DELAY_S, TEAM_NAMES } from '../shared/protocol';
import { CLASS_IDS, WEAPONS } from '../shared/weapons';
import { gameClient } from '../game/instance';
import { Panel, teamColorVar, truncateName } from './components';
import { WeaponIcon } from './components';
import { useNow } from './useNow';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

/** Accessoire signature affiché après le nom d'arme (carte du tueur). */
const WEAPON_ACCESSORY: Record<WeaponId, string> = {
  vsk27: 'VISEUR POINT ROUGE',
  kv9: 'LASER TACTIQUE',
  lr50: 'LUNETTE 8X',
  p9: 'VISEUR TRITIUM',
  m4: 'CARRY HANDLE',
  mp5: 'CROSSE RÉTRACTABLE',
  spas12: 'CHOKE TACTIQUE',
  deagle: 'CANON LOURD',
  custom1: 'ARME DU PACK',
  custom2: 'ARME DU PACK',
  custom3: 'ARME DU PACK',
};

const CLASS_LABEL: Record<ClassId, string> = { assault: 'ASSAUT', cqc: 'CQC', recon: 'RECON', breacher: 'BREACHER' };

/** Timestamp image-par-image « MM:SS:trames » (trames 0-23). */
function formatRecTimestamp(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  const frames = String(Math.floor((elapsedMs % 1000) / (1000 / 24))).padStart(2, '0');
  return `${mm}:${ss}:${frames}`;
}

export default function DeathScreen() {
  const killcam = useGameUI((s) => s.killcam);
  const players = useGameUI((s) => s.players);
  const myTeam = useGameUI((s) => s.myTeam);
  const scores = useGameUI((s) => s.scores);
  const classId = useGameUI((s) => s.classId);
  const setClassId = useGameUI((s) => s.setClassId);
  const connected = useGameUI((s) => s.connected);

  const now = useNow(100);
  const [mountedAt] = useState(() => Date.now());
  const [skipped, setSkipped] = useState(false);
  const [classGridOpen, setClassGridOpen] = useState(false);
  const skipAllowedAt = useRef(mountedAt + 800);

  const until = killcam?.until ?? mountedAt + RESPAWN_DELAY_S * 1000;
  const remainingMs = Math.max(0, until - now);
  const remainingS = Math.ceil(remainingMs / 1000);
  const elapsedMs = now - mountedAt;

  // Fenêtre killcam : première tranche du délai de réapparition (2,5 s),
  // skippable après 800 ms ; le reste = phase ATTENTE.
  const killcamWindowMs = Math.max(500, (RESPAWN_DELAY_S - 0) * 1000 - (RESPAWN_DELAY_S - KILLCAM_DURATION_S) * 1000);
  const inKillcam = !skipped && killcam !== null && remainingMs > Math.max(0, RESPAWN_DELAY_S * 1000 - killcamWindowMs);
  const respawning = remainingMs <= 350;

  // Clavier : ESPACE = passer la killcam, C = changer de classe,
  // 1/2/3 = choisir la classe quand la grille est ouverte.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && Date.now() >= skipAllowedAt.current) {
        e.preventDefault();
        setSkipped(true);
      } else if (e.code === 'KeyC') {
        setClassGridOpen((v) => !v);
      } else if (classGridOpen) {
        const idx =
          e.code === 'Digit1' || e.code === 'Numpad1' ? 0
          : e.code === 'Digit2' || e.code === 'Numpad2' ? 1
          : e.code === 'Digit3' || e.code === 'Numpad3' ? 2
          : -1;
        if (idx >= 0) {
          e.preventDefault();
          setClassId(CLASS_IDS[idx]);
          gameClient.setLoadout(CLASS_IDS[idx]);
          setClassGridOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [classGridOpen, setClassId]);

  const killer = killcam ? players.find((p) => p.id === killcam.killerId) : undefined;
  const killerTeam = killer?.team ?? (myTeam === 0 ? 1 : 0);
  const killerWeapon: WeaponId = killcam?.weapon ?? 'vsk27';
  const killerName = killcam?.killerName ?? 'INCONNU';

  const pickClass = (id: ClassId) => {
    setClassId(id);
    gameClient.setLoadout(id);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      className="absolute inset-0 z-40"
      style={{
        backdropFilter: 'saturate(0.25) contrast(1.1) brightness(0.85)',
        WebkitBackdropFilter: 'saturate(0.25) contrast(1.1) brightness(0.85)',
      }}
      role="dialog"
      aria-label="Éliminé"
    >
      {/* Flash de mort initial (danger 0.35, 120 ms, décroissance) */}
      <motion.div
        initial={{ opacity: 0.35 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="pointer-events-none absolute inset-0 bg-danger"
        aria-hidden="true"
      />
      {/* Vignette lourde + grain renforcé */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(4,6,8,0.7) 100%)' }} aria-hidden="true" />
      <div className="grain-overlay pointer-events-none absolute inset-0" style={{ opacity: 0.09 }} aria-hidden="true" />

      {/* Letterbox cinéma 64 px (entrée 300 ms) */}
      <motion.div initial={{ y: -64 }} animate={{ y: 0 }} exit={{ y: -64 }} transition={{ duration: 0.3, ease: EASE_OUT_EXPO }} className="absolute inset-x-0 top-0 h-16 bg-abyss" aria-hidden="true" />
      <motion.div initial={{ y: 64 }} animate={{ y: 0 }} exit={{ y: 64 }} transition={{ duration: 0.3, ease: EASE_OUT_EXPO }} className="absolute inset-x-0 bottom-0 h-16 bg-abyss" aria-hidden="true" />

      {/* Fallback visuel killcam (hors connexion : pas de caméra moteur) */}
      {!connected && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <motion.img
            src="/killcam-frame.png"
            alt=""
            initial={{ scale: 1 }}
            animate={{ scale: 1.06 }}
            transition={{ duration: 3, ease: 'linear' }}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
      )}

      {/* ===== B. Chrome KILLCAM (phase replay) ===== */}
      <AnimatePresence>
        {inKillcam && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.14 }}
          >
            {/* Haut-gauche : ● REC + KILLCAM + timestamp */}
            <div className="absolute left-8 top-20 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full bg-danger"
                style={{ animation: 'low-health-throb 1s steps(2, jump-none) infinite' }}
              />
              <span className="font-mono text-[13px] uppercase text-danger">REC</span>
              <span className="font-display text-[18px] font-semibold uppercase tracking-[0.2em] text-text-hi">
                KILLCAM
              </span>
              <span className="font-mono text-[14px] text-text-mid [font-variant-numeric:tabular-nums]">
                {formatRecTimestamp(elapsedMs)}
              </span>
            </div>
            {/* Haut-droit : hint PASSER */}
            <div className="chamfer-8 panel-surface absolute right-8 top-20 flex items-center gap-2 px-3 py-1.5">
              <span className="border border-line-strong px-1.5 font-hud text-[13px] font-semibold text-text-hi">
                ESPACE
              </span>
              <span className="font-hud text-[13px] font-semibold uppercase tracking-[0.14em] text-text-hi">
                PASSER LA KILLCAM
              </span>
            </div>
            {/* Marqueur VOUS (losange danger) */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
              <span className="block h-4 w-4 rotate-45 border-2 border-danger bg-danger/30" />
              <span className="mt-2 block text-center font-hud text-[11px] font-semibold uppercase tracking-[0.22em] text-danger">
                VOUS
              </span>
            </div>
            {/* Filet de lecture (2 px danger, progression linéaire) */}
            <div className="absolute inset-x-0 bottom-16 h-[2px] bg-[rgba(229,72,77,0.2)]" aria-hidden="true">
              <div
                className="h-full bg-danger"
                style={{
                  width: `${Math.min(100, (elapsedMs / (KILLCAM_DURATION_S * 1000)) * 100)}%`,
                  transition: 'width 100ms linear',
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== F. Phase ATTENTE (killcam passée/indisponible) ===== */}
      {!inKillcam && !respawning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-x-0 top-[30%] text-center"
        >
          <p className="font-display text-[44px] font-semibold uppercase tracking-[0.06em] text-text-hi opacity-90">
            VOUS ÊTES HORS COMBAT
          </p>
          <p className="mt-2 font-mono text-[13px] uppercase tracking-[0.08em] text-text-mid">
            VOTRE ESCOUADE TIENT LE FRONT — {scores[0]} À {scores[1]}
          </p>
        </motion.div>
      )}

      {/* ===== D. Carte du tueur (bas-gauche, 460 px) ===== */}
      <motion.div
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.4, duration: 0.24, ease: EASE_OUT_EXPO }}
        className="absolute bottom-24 left-8"
      >
        <Panel className="w-[460px] p-5" teamColor="var(--danger)">
          <p className="font-hud text-[13px] font-semibold uppercase tracking-[0.30em] text-danger">
            /// ÉLIMINÉ PAR
          </p>
          <div className="mt-2 flex items-center gap-3">
            <img
              src={killerTeam === 0 ? '/emblem-spectre.svg' : '/emblem-ravage.svg'}
              alt={TEAM_NAMES[killerTeam]}
              className="h-5 w-5"
              draggable={false}
            />
            <span
              className="font-display text-[32px] font-bold uppercase leading-none tracking-[0.04em]"
              style={{ color: teamColorVar(killerTeam) }}
            >
              {truncateName(killerName)}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2.5 border-t border-line pt-3">
            <span className="text-text-mid">
              <WeaponIcon weapon={killerWeapon} className="h-[18px] w-[18px]" />
            </span>
            <span className="font-hud text-[16px] font-semibold uppercase tracking-[0.08em] text-text-hi">
              {WEAPONS[killerWeapon].name} — {WEAPON_ACCESSORY[killerWeapon]}
            </span>
          </div>
          <p className="mt-2 font-mono text-[13px] uppercase tracking-[0.06em] text-text-mid">
            {TEAM_NAMES[killerTeam]} · {killer?.bot ? 'OPÉRATEUR IA' : 'JOUEUR'}
          </p>
        </Panel>
      </motion.div>

      {/* ===== E. Compte à rebours de réapparition (bas-centre) ===== */}
      <div className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-3">
        {/* Grille compacte changement de classe */}
        <AnimatePresence>
          {classGridOpen && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
              className="mb-1 flex gap-3"
            >
              {CLASS_IDS.map((id) => {
                const primaryId: WeaponId = id === 'assault' ? 'vsk27' : id === 'cqc' ? 'kv9' : 'lr50';
                const selected = classId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => pickClass(id)}
                    className={[
                      'chamfer-8 relative flex h-16 w-[200px] items-center gap-3 border px-3 transition-colors duration-fast',
                      selected ? 'border-line-strong bg-[rgba(245,158,31,0.10)]' : 'border-line bg-[rgba(13,19,26,0.72)] hover:border-line-strong',
                    ].join(' ')}
                    aria-pressed={selected}
                  >
                    {selected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-amber" />}
                    <img
                      src={`/weapon-${primaryId}.png`}
                      alt=""
                      className="h-8 w-20 object-contain"
                      draggable={false}
                    />
                    <span className="flex flex-col items-start">
                      <span className="font-hud text-[13px] font-semibold uppercase tracking-[0.14em] text-text-hi">
                        {CLASS_LABEL[id]}
                      </span>
                      <span className="font-mono text-[11px] uppercase text-text-dim">
                        {WEAPONS[primaryId].name}
                      </span>
                    </span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Anneau + chiffre */}
        <div className="flex items-center gap-4">
          <div className="relative flex h-12 w-12 items-center justify-center">
            <svg width={48} height={48} viewBox="0 0 48 48" className="absolute inset-0" aria-hidden="true">
              <circle cx={24} cy={24} r={21} fill="none" stroke="rgba(127,168,201,0.15)" strokeWidth={2} />
              <circle
                cx={24}
                cy={24}
                r={21}
                fill="none"
                stroke="var(--amber)"
                strokeWidth={2}
                strokeDasharray={2 * Math.PI * 21}
                strokeDashoffset={(2 * Math.PI * 21) * (1 - (remainingMs % 1000) / 1000)}
                transform="rotate(-90 24 24)"
              />
            </svg>
            {respawning ? (
              <Skull size={16} strokeWidth={1.5} className="text-amber" />
            ) : (
              <span
                key={remainingS}
                className="animate-countdown-pulse font-mono text-[22px] text-text-hi [font-variant-numeric:tabular-nums]"
              >
                {remainingS}
              </span>
            )}
          </div>
          <div className="flex flex-col items-start">
            <span className="font-hud text-[13px] font-semibold uppercase tracking-[0.18em] text-text-dim">
              {respawning ? 'RÉAPPARITION…' : 'RÉAPPARITION DANS'}
            </span>
            <button
              type="button"
              onClick={() => setClassGridOpen((v) => !v)}
              className="chamfer-6 mt-1 border border-line px-2 py-0.5 font-hud text-[12px] font-semibold uppercase tracking-[0.14em] text-text-hi transition-colors duration-fast hover:border-line-strong"
            >
              [C] CHANGER DE CLASSE
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
