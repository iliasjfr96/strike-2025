// ============================================================================
// STRIKE 2025 — server/test/rollback-probe.ts
// Sonde de diagnostic des rollbacks : rejoue la VRAIE logique client
// (Prediction à pas fixe 60 Hz + réconciliation par ack) contre un serveur
// réel, en bougeant en continu, et mesure chaque correction de la position de
// RENDU (= rollback perçu). Rapporte le compte, la magnitude et le contexte.
// Usage : node dist-server/test/rollback-probe.js [port] [durée_s]
// ============================================================================

import WebSocket from 'ws';
import { CLIENT_SIM_DT, decodeMsg, encodeMsg } from '../../src/shared/protocol.js';
import type { PlayerSnapshot, ServerMsg } from '../../src/shared/protocol.js';
import { KEY_FORWARD, KEY_JUMP, KEY_LEFT, KEY_RIGHT, KEY_SPRINT } from '../../src/shared/sim.js';
import { Prediction } from '../../src/game/net/Prediction.js';

const PORT = Number(process.argv[2] ?? 3211);
const DURATION_S = Number(process.argv[3] ?? 30);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const prediction = new Prediction();

let myId = -1;
let welcomed = false;
let simAcc = 0;
let lastLoop = 0;
let seqYaw = 0;

// Statistiques
let snaps = 0;
let reconciles = 0;
let corrections = 0; // |Δ position de rendu| > seuil visible
let maxCorrection = 0;
let sumCorrection = 0;
let respawns = 0;
const correctionLog: string[] = [];

const renderBefore = { x: 0, y: 0, z: 0 };
const renderAfter = { x: 0, y: 0, z: 0 };

function keysAt(tMs: number): number {
  // Mouvement varié : avant+sprint, strafes alternés, sauts périodiques.
  let k = KEY_FORWARD | KEY_SPRINT;
  const phase = Math.floor(tMs / 700) % 4;
  if (phase === 1) k |= KEY_LEFT;
  if (phase === 3) k |= KEY_RIGHT;
  if (Math.floor(tMs / 1900) % 3 === 0 && tMs % 1900 < 60) k |= KEY_JUMP;
  return k;
}

ws.on('open', () => {
  ws.send(encodeMsg({ t: 'hello', name: 'PROBE', classId: 'assault' }));
});

ws.on('message', (data: Buffer) => {
  const msg = decodeMsg<ServerMsg>(data.toString());
  if (msg === null) return;
  if (msg.t === 'welcome') {
    myId = msg.id;
    welcomed = true;
    return;
  }
  if (msg.t === 'ev' && msg.kind === 'respawn' && msg.id === myId) {
    prediction.reset(msg.x, msg.y, msg.z, msg.yaw);
    respawns++;
    return;
  }
  if (msg.t !== 'snap') return;
  snaps++;
  let mine: PlayerSnapshot | null = null;
  for (const p of msg.pl) if (p[0] === myId) mine = p;
  if (!mine) return;

  const alpha = simAcc / CLIENT_SIM_DT;
  prediction.renderPos(renderBefore, alpha);
  reconciles++;
  prediction.reconcile(mine, alpha);
  prediction.renderPos(renderAfter, alpha);
  const d = Math.hypot(
    renderAfter.x - renderBefore.x,
    renderAfter.y - renderBefore.y,
    renderAfter.z - renderBefore.z,
  );
  if (d > 0.03) {
    corrections++;
    sumCorrection += d;
    if (d > maxCorrection) maxCorrection = d;
    if (correctionLog.length < 25) {
      correctionLog.push(
        `t=${(performance.now() - t0).toFixed(0)}ms ack=${mine[10]} d=${d.toFixed(3)}m ` +
          `serveur=(${mine[1]},${mine[2]},${mine[3]}) rendu_avant=(${renderBefore.x.toFixed(2)},${renderBefore.y.toFixed(2)},${renderBefore.z.toFixed(2)})`,
      );
    }
  }
});

let t0 = 0;
// Boucle de simulation : pas fixe 1/60, flush batché ~33 ms (mimique GameClient).
let lastFlush = 0;
const loop = setInterval(() => {
  if (!welcomed) return;
  const now = performance.now();
  if (t0 === 0) {
    t0 = now;
    lastLoop = now;
    lastFlush = now;
  }
  const dt = Math.min(0.1, (now - lastLoop) / 1000);
  lastLoop = now;
  simAcc += dt;
  if (simAcc > CLIENT_SIM_DT * 8) simAcc = CLIENT_SIM_DT * 8;
  // Yaw tourne lentement (trajectoires courbes = collisions variées).
  seqYaw += dt * 0.35;
  prediction.yaw = seqYaw;
  prediction.pitch = 0;
  prediction.speedMult = 1;
  const keys = keysAt(now - t0);
  while (simAcc >= CLIENT_SIM_DT) {
    simAcc -= CLIENT_SIM_DT;
    prediction.step(CLIENT_SIM_DT, keys);
  }
  if (now - lastFlush >= 33) {
    lastFlush = now;
    const unsent = prediction.drainUnsent();
    if (unsent.length > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(
        encodeMsg({
          t: 'inputs',
          list: unsent.map((i) => ({ seq: i.seq, dt: i.dt, yaw: i.yaw, pitch: i.pitch, keys: i.keys })),
        }),
      );
      const at = Date.now();
      for (const i of unsent) i.sentAt = at;
    }
  }
}, 4);

setTimeout(() => {
  clearInterval(loop);
  ws.close();
  console.log('=== SONDE ROLLBACK — RÉSULTATS ===');
  console.log(`durée: ${DURATION_S}s · snapshots: ${snaps} · réconciliations: ${reconciles} · respawns: ${respawns}`);
  console.log(`corrections visibles (>3 cm): ${corrections}`);
  if (corrections > 0) {
    console.log(`  moyenne: ${(sumCorrection / corrections).toFixed(3)} m · max: ${maxCorrection.toFixed(3)} m`);
    console.log('  détail (25 premières):');
    for (const l of correctionLog) console.log('   ', l);
  }
  process.exit(0);
}, DURATION_S * 1000 + 3000);
