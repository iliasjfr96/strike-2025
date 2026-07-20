// ============================================================================
// STRIKE 2025 — physics-fuzz.ts (sonde diagnostique, non incluse dans e2e)
// Fuzz de stepBody contre les colliders réels de KESTREL YARD : détecte les
// éjections hors map et les téléportations verticales (> saut possible en un
// pas). Reproduit le bug « je me retrouve hors de la map » signalé en jeu.
// ============================================================================

import { MAP_COLLIDERS, SPAWNS } from '../../src/shared/map.js';
import {
  KEY_BACK,
  KEY_FORWARD,
  KEY_JUMP,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_SPRINT,
  makeBody,
  stepBody,
} from '../../src/shared/sim.js';
import type { AABB, BodyState } from '../../src/shared/sim.js';

const COLLIDERS = MAP_COLLIDERS as AABB[];
const DT = 1 / 60;
// Bornes jouables (murs : x -32.6..35, z -48.6..48.6 ; tour max 10.8 m).
const X_MIN = -33, X_MAX = 35.5, Z_MIN = -49, Z_MAX = 49, Y_MAX = 11.5;
// Saut max en un pas : vitesse verticale saut 7.5 -> ~0.125 m/pas. Step-up 0.45.
const MAX_DY_PER_STEP = 0.6;

let seed = 1234567;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

interface Anomaly {
  kind: string;
  step: number;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  keys: number;
  yaw: number;
}

const anomalies: Anomaly[] = [];

function runEpisode(ep: number): void {
  const spawnsAll = [...SPAWNS[0], ...SPAWNS[1]];
  const sp = spawnsAll[Math.floor(rnd() * spawnsAll.length)];
  const body: BodyState = makeBody(sp.x, sp.y, sp.z);
  let yaw = rnd() * Math.PI * 2;
  let keys = 0;

  for (let i = 0; i < 3600; i++) { // 60 s simulées par épisode
    // Politique d'input agressive : cap tenu longtemps (fonce dans les murs
    // et les coins), virages occasionnels, saut/sprint fréquents.
    if (rnd() < 0.02) yaw = rnd() * Math.PI * 2;
    if (rnd() < 0.05) yaw += (rnd() - 0.5) * 0.8;
    if (rnd() < 0.03) {
      keys = 0;
      if (rnd() < 0.9) keys |= KEY_FORWARD;
      else if (rnd() < 0.5) keys |= KEY_BACK;
      if (rnd() < 0.25) keys |= KEY_LEFT;
      else if (rnd() < 0.25) keys |= KEY_RIGHT;
      if (rnd() < 0.5) keys |= KEY_SPRINT;
    }
    const jump = rnd() < 0.08 ? KEY_JUMP : 0;

    const fx = body.pos.x, fy = body.pos.y, fz = body.pos.z;
    stepBody(body, { yaw, pitch: 0, keys: keys | jump }, COLLIDERS, DT, 1);
    const { x, y, z } = body.pos;

    const outOfBounds = x < X_MIN || x > X_MAX || z < Z_MIN || z > Z_MAX || y > Y_MAX;
    const teleportY = y - fy > MAX_DY_PER_STEP;
    if (outOfBounds || teleportY) {
      anomalies.push({
        kind: outOfBounds ? 'HORS-MAP' : 'TÉLÉPORT-Y',
        step: ep * 3600 + i,
        from: { x: +fx.toFixed(2), y: +fy.toFixed(2), z: +fz.toFixed(2) },
        to: { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) },
        keys: keys | jump,
        yaw: +yaw.toFixed(3),
      });
      return; // épisode suivant (une anomalie par épisode suffit)
    }
  }
}

const EPISODES = 300;
for (let ep = 0; ep < EPISODES; ep++) runEpisode(ep);

console.log(`Fuzz stepBody : ${EPISODES} épisodes × 60 s simulées (${EPISODES} minutes de course agressive)`);
if (anomalies.length === 0) {
  console.log('Aucune anomalie détectée.');
} else {
  console.log(`${anomalies.length} anomalie(s) :`);
  for (const a of anomalies.slice(0, 20)) {
    console.log(
      ` ${a.kind} @pas ${a.step} : (${a.from.x},${a.from.y},${a.from.z}) -> (${a.to.x},${a.to.y},${a.to.z}) keys=${a.keys.toString(2)} yaw=${a.yaw}`,
    );
  }
}
process.exit(anomalies.length === 0 ? 0 : 1);
