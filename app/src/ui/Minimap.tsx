// ============================================================================
// STRIKE 2025 — Minimap.tsx (hud.md Module 6 — radar circulaire 180 px)
// Canvas 2D (30 fps) : fond /minimap-port.png en faible opacité + boîtes de
// shared/map.ts projetées (XZ -> disque) + balayage conique §7.8 (DOM) +
// alliés bleus toujours (flèche blanche = joueur local) + ennemis rouges
// UNIQUEMENT si UAV actif (minimap.uavUntil, converti via serverOffsetMs).
// Graduations cardinales N/E/S/O. Qualité FAIBLE -> 20 fps.
// Champs store lus (bridge.md §2) : minimap, myId, myTeam, serverOffsetMs,
// settings.quality.
// ============================================================================

import { memo, useEffect, useRef } from 'react';
import { useGameUI } from './store';
import { MAP_BOUNDS, MAP_BOXES } from '../shared/map';

const SIZE = 180;
const HALF = SIZE / 2;
const MAP_IMG_SRC = '/minimap-port.png';

/** Projection monde (x,z) -> disque radar (nord-up, +X à droite). */
function project(x: number, z: number): [number, number] {
  const spanX = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
  const spanZ = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
  const scale = (HALF - 10) / (Math.max(spanX, spanZ) / 2);
  const cx = (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) / 2;
  const cz = (MAP_BOUNDS.minZ + MAP_BOUNDS.maxZ) / 2;
  return [HALF + (x - cx) * scale, HALF + (z - cz) * scale];
}

function drawRadar(): void {
  const canvas = canvasRef.current;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { minimap, myId, serverOffsetMs } = useGameUI.getState();
  const now = Date.now();
  const uavActive = minimap.uavUntil > 0 && minimap.uavUntil - serverOffsetMs > now;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  // Masque circulaire
  ctx.beginPath();
  ctx.arc(HALF, HALF, HALF - 1, 0, Math.PI * 2);
  ctx.clip();

  // Fond sombre (les boîtes vectorielles de la map font office de plan).
  ctx.fillStyle = 'rgba(6,9,12,0.7)';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Boîtes de la map projetées (contours fins bleu acier)
  for (const b of MAP_BOXES) {
    const [x0, y0] = project(b.min.x, b.min.z);
    const [x1, y1] = project(b.max.x, b.max.z);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 1.2 && h < 1.2) continue; // mâts de lampadaires : ignorés
    if (b.kind === 'wall') {
      ctx.strokeStyle = 'rgba(127,168,201,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, w, h);
    } else if (b.kind === 'container') {
      ctx.fillStyle = 'rgba(127,168,201,0.28)';
      ctx.fillRect(x0, y0, w, h);
    } else {
      ctx.fillStyle = 'rgba(127,168,201,0.14)';
      ctx.fillRect(x0, y0, w, h);
    }
  }

  // Alliés : points bleus 6 px ; joueur local : flèche blanche 10 px (yaw)
  for (const a of minimap.allies) {
    const [px, py] = project(a.x, a.z);
    if (a.id === myId) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a.yaw + Math.PI);
      ctx.fillStyle = '#EAF0F5';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = '#58A6E8';
      ctx.fillRect(px - 3, py - 3, 6, 6);
    }
  }

  // Ennemis : triangles rouges 7 px — UNIQUEMENT si UAV actif
  if (uavActive) {
    ctx.fillStyle = '#F07F13';
    for (const e of minimap.enemies) {
      const [px, py] = project(e.x, e.z);
      ctx.beginPath();
      ctx.moveTo(px, py - 3.5);
      ctx.lineTo(px + 3.5, py + 3.5);
      ctx.lineTo(px - 3.5, py + 3.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

// Références module (canvas unique + image préchargée)
const canvasRef: { current: HTMLCanvasElement | null } = { current: null };
const mapImg = new Image();
mapImg.src = MAP_IMG_SRC;

function MinimapInner() {
  const quality = useGameUI((s) => s.settings.quality);
  const uavUntil = useGameUI((s) => s.minimap.uavUntil);
  const serverOffsetMs = useGameUI((s) => s.serverOffsetMs);
  const localRef = useRef<HTMLCanvasElement | null>(null);

  const uavActive = uavUntil > 0 && uavUntil - serverOffsetMs > Date.now();

  // Boucle canvas 30 fps (20 fps en qualité FAIBLE) — throttle par timestamp
  useEffect(() => {
    canvasRef.current = localRef.current;
    const fps = quality === 'low' ? 20 : 30;
    const frameMs = 1000 / fps;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < frameMs) return;
      last = t;
      drawRadar();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      canvasRef.current = null;
    };
  }, [quality]);

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      {/* Disque radar */}
      <div
        className="relative overflow-hidden rounded-full border border-line-strong backdrop-blur-[8px]"
        style={{ width: SIZE, height: SIZE, background: 'rgba(6,9,12,0.7)' }}
      >
        <canvas ref={localRef} width={SIZE} height={SIZE} style={{ display: 'block', width: SIZE, height: SIZE }} />
        {/* Balayage conique §7.8 (×2 vitesse si UAV actif) */}
        <div
          aria-hidden="true"
          className="animate-radar-sweep pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: 'conic-gradient(rgba(88,166,232,0.25), transparent 60deg)',
            animationDuration: uavActive ? '1.5s' : '3s',
          }}
        />
      </div>
      {/* Graduations cardinales (micro 9 px) à l'extérieur */}
      <span className="absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[9px] text-text-dim">N</span>
      <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 font-mono text-[9px] text-text-dim">S</span>
      <span className="absolute -right-4 top-1/2 -translate-y-1/2 font-mono text-[9px] text-text-dim">E</span>
      <span className="absolute -left-4 top-1/2 -translate-y-1/2 font-mono text-[9px] text-text-dim">O</span>
    </div>
  );
}

const Minimap = memo(MinimapInner);
export default Minimap;
