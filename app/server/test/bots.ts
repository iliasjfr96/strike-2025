// ============================================================================
// STRIKE 2025 — server/test/bots.ts
// Test E2E headless (architecture.md §5) : clients WebSocket Node (lib `ws`)
// contre le serveur bundlé (dist-server/index.js) lancé en processus enfant.
//
//  1. HTTP : /healthz, / (HTML), /nope (fallback SPA), upgrade /autre refusé,
//     upgrade /ws accepté.
//  2. Join : 4 clients (Alpha/Bravo/Charlie/Delta), welcome DRYDOCK, tickRate
//     30, players.length progressif jusqu'à 4, équilibrage 2 SPECTRE / 2 RAVAGE.
//  3. Snapshots : >= 45 snaps en 3 s (≈ 20 Hz).
//  4. Combat : marche aux waypoints + tir à la cadence de l'arme ; assertions
//     kill / scores / hit (tireur) / damage (victime) / respawn ~3 s avec
//     protection / zéro friendly fire.
//  5. Fin de partie (STRIKE_MATCH_DURATION_S=25) : ev phase=end <= 35 s, stats
//     4 joueurs, winner cohérent, re-playing après ~15 s, scores remis à 0.
//  6. Déconnexion : ev leave ; join en cours de partie (welcome complet).
//  7. Bots serveur (2e serveur SANS STRIKE_DISABLE_BOTS) : 1 humain -> 4v4
//     (7 bots, join bot:true, noms BOT-xxx) ; des bots partent quand des
//     humains arrivent dans une équipe pleine.
//
// Exit 0 si tout passe, 1 sinon (log clair de chaque assertion).
// ============================================================================

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import type {
  ClassId,
  EvDamage,
  EvHit,
  EvJoin,
  EvKill,
  EvLeave,
  EvMsg,
  EvPhase,
  EvRespawn,
  GamePhase,
  PlayerInfo,
  PlayerSnapshot,
  TeamScores,
  WeaponId,
  WelcomeMsg,
} from '../../src/shared/protocol.js';
import { WAYPOINT_CENTER } from '../../src/shared/map.js';
import { CLASS_DEFS, WEAPONS } from '../../src/shared/weapons.js';

// ---------------------------------------------------------------------------
// Utilitaires de test
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BUNDLE = path.resolve(here, '..', 'index.js');

const PORT = 3100;
const PORT2 = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const BASE2 = `http://127.0.0.1:${PORT2}`;

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  OK  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL : ${label}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Attend qu'une condition devienne vraie (poll 50 ms). true si atteinte. */
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await sleep(50);
  }
  return cond();
}

/** Lance le serveur bundlé en enfant avec les hooks d'environnement §7. */
function startServer(port: number, extraEnv: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, [SERVER_BUNDLE], {
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[srv:${port}] ${d}`));
  child.stderr?.on('data', (d: Buffer) => process.stdout.write(`[srv:${port}:err] ${d}`));
  return child;
}

async function waitHealthz(base: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.status === 200 && (await r.text()) === 'ok') return true;
    } catch {
      /* pas encore prêt */
    }
    await sleep(150);
  }
  return false;
}

/** Tente un upgrade WS ; true si la connexion s'ouvre. */
function tryUpgrade(base: string, wsPath: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const ws = new WebSocket(`${base.replace('http', 'ws')}${wsPath}`);
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      try {
        ws.terminate();
      } catch {
        /* ignoré */
      }
      resolve(ok);
    };
    const to = setTimeout(() => finish(false), timeoutMs);
    ws.on('open', () => finish(true));
    ws.on('error', () => finish(false));
  });
}

// ---------------------------------------------------------------------------
// Client de test headless
// ---------------------------------------------------------------------------

interface TimedEv<T> {
  ev: T;
  at: number;
}

class TestClient {
  ws!: WebSocket;
  readonly name: string;
  readonly classId: ClassId;
  readonly weaponId: WeaponId;

  id = -1;
  welcome: WelcomeMsg | null = null;
  players = new Map<number, PlayerInfo>();
  /** Ids de tous les bots connus (même partis) — pour compter les départs. */
  botIds = new Set<number>();
  snapPl: PlayerSnapshot[] = [];
  mySnap: PlayerSnapshot | null = null;
  snapCount = 0;
  phase: GamePhase = 'lobby';
  scores: TeamScores = [0, 0];

  joins: TimedEv<EvJoin>[] = [];
  leaves: TimedEv<EvLeave>[] = [];
  kills: TimedEv<EvKill>[] = [];
  hits: TimedEv<EvHit>[] = [];
  damages: TimedEv<EvDamage>[] = [];
  respawns: TimedEv<EvRespawn>[] = [];
  phases: TimedEv<EvPhase>[] = [];
  scoreEvs: TimedEv<TeamScores>[] = [];

  // État de comportement (marche / tir).
  inputSeq = 0;
  shootSeq = 0;
  wpIdx = 0;
  wpDir: 1 | -1 = 1;
  shotsSinceReload = 0;
  reloadBlockUntil = 0;
  friendlyShots = 0;
  enemyShots = 0;
  inputTimer: ReturnType<typeof setInterval> | null = null;
  shootTimer: ReturnType<typeof setInterval> | null = null;

  constructor(name: string, classId: ClassId) {
    this.name = name;
    this.classId = classId;
    this.weaponId = CLASS_DEFS[classId].loadout[0];
  }

  get team(): number {
    return this.players.get(this.id)?.team ?? -1;
  }

  handle(raw: unknown): void {
    let msg: { t?: string };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const at = Date.now();
    if (msg.t === 'welcome') {
      const w = msg as WelcomeMsg;
      this.welcome = w;
      this.id = w.id;
      this.phase = w.phase;
      this.scores = [...w.scores] as TeamScores;
      for (const p of w.players) {
        this.players.set(p.id, p);
        if (p.bot) this.botIds.add(p.id);
      }
      return;
    }
    if (msg.t === 'snap') {
      const s = msg as { pl: PlayerSnapshot[] };
      this.snapPl = s.pl;
      this.snapCount++;
      this.mySnap = s.pl.find((e) => e[0] === this.id) ?? null;
      return;
    }
    if (msg.t !== 'ev') return;
    const ev = msg as EvMsg;
    switch (ev.kind) {
      case 'join':
        this.players.set(ev.player.id, ev.player);
        if (ev.player.bot) this.botIds.add(ev.player.id);
        this.joins.push({ ev, at });
        return;
      case 'leave':
        this.players.delete(ev.id);
        this.leaves.push({ ev, at });
        return;
      case 'kill':
        this.kills.push({ ev, at });
        this.scores = [...ev.scores] as TeamScores;
        return;
      case 'hit':
        this.hits.push({ ev, at });
        return;
      case 'damage':
        this.damages.push({ ev, at });
        return;
      case 'respawn':
        this.respawns.push({ ev, at });
        return;
      case 'phase':
        this.phase = ev.phase;
        this.phases.push({ ev, at });
        return;
      case 'score':
        this.scores = [...ev.scores] as TeamScores;
        this.scoreEvs.push({ ev: this.scores, at });
        return;
      default:
        return;
    }
  }

  /** Ennemi vivant le plus proche dans le dernier snapshot (<= maxDist). */
  nearestEnemy(maxDist: number): PlayerSnapshot | null {
    return this.nearest(maxDist, false);
  }

  nearestAlly(maxDist: number): PlayerSnapshot | null {
    return this.nearest(maxDist, true);
  }

  private nearest(maxDist: number, ally: boolean): PlayerSnapshot | null {
    const me = this.mySnap;
    if (!me) return null;
    let best: PlayerSnapshot | null = null;
    let bestD = maxDist;
    for (const e of this.snapPl) {
      if (e[0] === this.id || e[7] <= 0) continue;
      const info = this.players.get(e[0]);
      if (!info) continue;
      const sameTeam = info.team === this.team;
      if (sameTeam !== ally) continue;
      const d = Math.hypot(e[1] - me[1], e[2] - me[2], e[3] - me[3]);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Comportement de combat : input 30 Hz vers le centre + tir à cadence. */
  startBehavior(): void {
    // Initialisation de la marche sur le couloir CENTRE (lignes de vue longues).
    const meX = this.mySnap ? this.mySnap[1] : this.team === 1 ? 39 : -39;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WAYPOINT_CENTER.length; i++) {
      const d = Math.abs(WAYPOINT_CENTER[i][0] - meX);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.wpIdx = best;
    this.wpDir = this.team === 1 ? -1 : 1;

    this.inputTimer = setInterval(() => {
      if (this.id < 0 || !this.mySnap || this.ws.readyState !== this.ws.OPEN) return;
      const me = this.mySnap;
      let yaw: number;
      const enemy = this.nearestEnemy(40);
      if (enemy) {
        yaw = Math.atan2(-(enemy[1] - me[1]), -(enemy[3] - me[3]));
      } else {
        const wp = WAYPOINT_CENTER[this.wpIdx];
        if (Math.hypot(wp[0] - me[1], wp[1] - me[3]) < 2) {
          this.wpIdx += this.wpDir;
          if (this.wpIdx < 0 || this.wpIdx >= WAYPOINT_CENTER.length) {
            this.wpDir = this.wpDir === 1 ? -1 : 1;
            this.wpIdx += this.wpDir * 2;
            this.wpIdx = Math.max(0, Math.min(WAYPOINT_CENTER.length - 1, this.wpIdx));
          }
        }
        const wp2 = WAYPOINT_CENTER[this.wpIdx];
        yaw = Math.atan2(-(wp2[0] - me[1]), -(wp2[1] - me[3]));
      }
      try {
        this.ws.send(
          JSON.stringify({
            t: 'input',
            seq: ++this.inputSeq,
            dt: 1 / 30,
            yaw,
            pitch: 0,
            keys: 1 | 64, // KEY_FORWARD | KEY_SPRINT
          }),
        );
      } catch {
        /* socket fermé */
      }
    }, 33);

    const iv = 60000 / WEAPONS[this.weaponId].rpm;
    this.shootTimer = setInterval(() => {
      if (this.phase !== 'playing' || !this.mySnap || this.mySnap[7] <= 0) return;
      if (this.ws.readyState !== this.ws.OPEN) return;
      const now = Date.now();
      if (now < this.reloadBlockUntil) return;
      const me = this.mySnap;
      const eye = { x: me[1], y: me[2] + 1.62, z: me[3] };

      let target: { x: number; y: number; z: number } | null = null;
      let friendly = false;
      const enemy = this.nearestEnemy(35);
      if (enemy) {
        target = { x: enemy[1], y: enemy[2] + 0.9, z: enemy[3] };
      } else {
        const ally = this.nearestAlly(25);
        if (ally) {
          target = { x: ally[1], y: ally[2] + 0.9, z: ally[3] };
          friendly = true;
        }
      }
      if (!target) return;
      const dx = target.x - eye.x;
      const dy = target.y - eye.y;
      const dz = target.z - eye.z;
      const n = Math.hypot(dx, dy, dz);
      if (n < 0.5) return;
      try {
        this.ws.send(
          JSON.stringify({
            t: 'shoot',
            seq: ++this.shootSeq,
            ox: eye.x,
            oy: eye.y,
            oz: eye.z,
            dx: dx / n,
            dy: dy / n,
            dz: dz / n,
            weapon: this.weaponId,
            ads: false,
          }),
        );
      } catch {
        return;
      }
      if (friendly) this.friendlyShots++;
      else this.enemyShots++;
      this.shotsSinceReload++;
      if (this.shotsSinceReload >= WEAPONS[this.weaponId].magSize - 2) {
        try {
          this.ws.send(JSON.stringify({ t: 'reload' }));
        } catch {
          /* ignoré */
        }
        this.shotsSinceReload = 0;
        this.reloadBlockUntil = Date.now() + WEAPONS[this.weaponId].reloadMs + 200;
      }
    }, Math.ceil(iv * 1.15));
  }

  stopBehavior(): void {
    if (this.inputTimer) clearInterval(this.inputTimer);
    if (this.shootTimer) clearInterval(this.shootTimer);
    this.inputTimer = null;
    this.shootTimer = null;
  }

  close(): void {
    this.stopBehavior();
    try {
      this.ws.close();
    } catch {
      /* ignoré */
    }
  }
}

/** Connexion + hello ; résout à la réception du welcome. */
function connectClient(name: string, classId: ClassId, base = BASE): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const c = new TestClient(name, classId);
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    c.ws = ws;
    let settled = false;
    const to = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`timeout connexion ${name}`));
      }
    }, 6000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', name, classId }));
    });
    ws.on('message', (data: unknown) => {
      c.handle(data);
      if (!settled && c.welcome && c.id >= 0) {
        settled = true;
        clearTimeout(to);
        resolve(c);
      }
    });
    ws.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(to);
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Scénario principal
// ---------------------------------------------------------------------------

const children: ChildProcess[] = [];

function killChildren(): void {
  for (const ch of children) {
    try {
      ch.kill('SIGTERM');
    } catch {
      /* ignoré */
    }
  }
}

async function main(): Promise<void> {
  console.log('=== STRIKE 2025 — test E2E headless ===');
  const server1 = startServer(PORT, {
    STRIKE_MATCH_DURATION_S: '25',
    STRIKE_DISABLE_BOTS: '1',
  });
  children.push(server1);
  const clients: TestClient[] = [];

  try {
    assert(await waitHealthz(BASE, 10000), 'serveur démarré (GET /healthz -> 200 « ok »)');

    // ---- 1. HTTP -----------------------------------------------------------
    console.log('\n[1] HTTP');
    {
      const r = await fetch(`${BASE}/healthz`);
      const body = await r.text();
      assert(r.status === 200 && body === 'ok', 'GET /healthz == 200 « ok »');
    }
    {
      const r = await fetch(`${BASE}/`);
      const body = await r.text();
      assert(r.status === 200 && /<!doctype html|<html/i.test(body), 'GET / == HTML');
    }
    {
      const r = await fetch(`${BASE}/nope`);
      const body = await r.text();
      assert(r.status === 200 && /<!doctype html|<html/i.test(body), 'GET /nope == HTML (fallback SPA)');
    }
    assert(!(await tryUpgrade(BASE, '/autre')), 'upgrade WS sur /autre refusé');
    assert(await tryUpgrade(BASE, '/ws'), 'upgrade WS sur /ws accepté');

    // ---- 2. Join ------------------------------------------------------------
    console.log('\n[2] Join de 4 clients');
    const defs: [string, ClassId][] = [
      ['Alpha', 'assault'],
      ['Bravo', 'cqc'],
      ['Charlie', 'recon'],
      ['Delta', 'assault'],
    ];
    for (let i = 0; i < defs.length; i++) {
      const c = await connectClient(defs[i][0], defs[i][1]);
      clients.push(c);
      const w = c.welcome!;
      assert(w.mapMeta.name === 'KESTREL YARD', `${c.name} : mapMeta.name === 'KESTREL YARD'`);
      assert(w.config.tickRate === 30 && w.config.snapRate === 30, `${c.name} : config tickRate 30 / snapRate 30`);
      assert(w.players.length === i + 1, `${c.name} : welcome players.length === ${i + 1}`);
    }
    const w4 = clients[3].welcome!;
    const nb0 = w4.teams.find((t) => t.team === 0)!.playerIds.length;
    const nb1 = w4.teams.find((t) => t.team === 1)!.playerIds.length;
    assert(nb0 === 2 && nb1 === 2, `équilibrage 2 SPECTRE / 2 RAVAGE (reçu ${nb0}v${nb1})`);
    const joinsOk = await waitFor(() => clients[0].joins.length >= 3, 2000);
    assert(joinsOk, `ev join cohérents reçus pour les 3 autres joueurs (${clients[0].joins.length})`);

    // ---- 3. Snapshots ---------------------------------------------------------
    console.log('\n[3] Snapshots (3 s)');
    clients[0].snapCount = 0;
    await sleep(3000);
    assert(clients[0].snapCount >= 45, `snaps reçus en 3 s >= 45 (${clients[0].snapCount})`);

    // ---- 4. Combat -------------------------------------------------------------
    console.log('\n[4] Combat');
    for (const c of clients) c.startBehavior();
    const combatOk = await waitFor(() => {
      const anyKill = clients.some((c) => c.kills.length >= 1);
      const anyHit = clients.some((c) => c.hits.length >= 1);
      const anyDmg = clients.some((c) => c.damages.length >= 1);
      const first = clients[0].kills[0];
      const respawned =
        first !== undefined &&
        clients.some((c) => c.respawns.some((r) => r.ev.id === first.ev.victimId && r.at >= first.at));
      return anyKill && anyHit && anyDmg && respawned;
    }, 60000);
    assert(combatOk, 'fenêtre combat : kill + hit + damage + respawn observés');

    const ref = clients[0];
    assert(ref.kills.length >= 1, `au moins 1 ev kill (${ref.kills.length})`);
    const lastKill = ref.kills[ref.kills.length - 1];
    assert(
      lastKill !== undefined && lastKill.ev.scores[0] + lastKill.ev.scores[1] >= 1,
      'scores incrémentés après kill',
    );
    assert(clients.some((c) => c.hits.length >= 1), 'ev hit reçu par un tireur');
    assert(clients.some((c) => c.damages.length >= 1), 'ev damage reçu par une victime');

    const firstKill = ref.kills[0];
    if (firstKill) {
      const resp = ref.respawns.find((r) => r.ev.id === firstKill.ev.victimId && r.at >= firstKill.at);
      assert(resp !== undefined, 'ev respawn reçu après le kill');
      if (resp) {
        const dt = resp.at - firstKill.at;
        assert(dt >= 2400 && dt <= 4600, `respawn après ~3 s (${(dt / 1000).toFixed(2)} s)`);
        assert(resp.ev.protectUntil > resp.at, 'protectUntil > now au respawn');
      }
    } else {
      assert(false, 'ev respawn reçu après le kill');
    }

    // Friendly fire : aucun hit / damage / kill entre joueurs de la même équipe.
    let friendlyHit = 0;
    let friendlyDmg = 0;
    for (const c of clients) {
      for (const h of c.hits) {
        if (c.players.get(h.ev.targetId)?.team === c.team) friendlyHit++;
      }
      for (const d of c.damages) {
        if (c.players.get(d.ev.fromId)?.team === c.team) friendlyDmg++;
      }
    }
    let friendlyKill = 0;
    for (const k of ref.kills) {
      const kt = ref.players.get(k.ev.killerId)?.team;
      const vt = ref.players.get(k.ev.victimId)?.team;
      if (kt !== undefined && kt === vt) friendlyKill++;
    }
    const probes = clients.reduce((s, c) => s + c.friendlyShots, 0);
    assert(friendlyHit === 0, 'aucun friendly hit');
    assert(friendlyDmg === 0, 'aucun friendly damage');
    assert(friendlyKill === 0, 'aucun friendly kill');
    assert(probes > 0, `tirs de probe sur alliés réellement effectués (${probes})`);

    // ---- 5. Fin de partie -------------------------------------------------------
    console.log('\n[5] Fin de partie (durée configurée : 25 s)');
    const endOk = await waitFor(() => ref.phases.some((p) => p.ev.phase === 'end'), 35000);
    assert(endOk, 'ev phase=end reçu (<= 35 s)');
    const endEv = ref.phases.find((p) => p.ev.phase === 'end');
    if (endEv) {
      assert(endEv.ev.stats.length === 4, `stats complets : 4 joueurs (${endEv.ev.stats.length})`);
      const s0 = endEv.ev.stats.filter((s) => s.team === 0).reduce((n, s) => n + s.kills, 0);
      const s1 = endEv.ev.stats.filter((s) => s.team === 1).reduce((n, s) => n + s.kills, 0);
      const coherent =
        (s0 > s1 && endEv.ev.winner === 0) ||
        (s1 > s0 && endEv.ev.winner === 1) ||
        (s0 === s1 && endEv.ev.winner === -1);
      assert(coherent, `winner cohérent avec les scores (kills ${s0}-${s1}, winner ${endEv.ev.winner})`);

      const replayOk = await waitFor(
        () => ref.phases.some((p) => p.ev.phase === 'playing' && p.at >= endEv.at),
        22000,
      );
      assert(replayOk, 'ev phase=playing après ~15 s (nouvelle partie)');
      const resetScore = ref.scoreEvs.some((s) => s.at >= endEv.at && s.ev[0] === 0 && s.ev[1] === 0);
      assert(resetScore, 'scores remis à 0 (ev score [0,0])');
    } else {
      assert(false, 'stats complets : 4 joueurs (0)');
      assert(false, 'winner cohérent avec les scores');
      assert(false, 'ev phase=playing après ~15 s');
      assert(false, 'scores remis à 0');
    }

    // ---- 6. Déconnexion + join en cours -------------------------------------------
    console.log('\n[6] Déconnexion + join en cours de partie');
    const departed = clients[3];
    const departedId = departed.id;
    departed.close();
    const leaveOk = await waitFor(() => ref.leaves.some((l) => l.ev.id === departedId), 4000);
    assert(leaveOk, 'ev leave reçu par les autres après fermeture du socket');
    const echo = await connectClient('Echo', 'recon');
    clients.push(echo);
    assert(
      echo.welcome!.players.length === 4,
      `join en cours : welcome players.length === 4 (${echo.welcome!.players.length})`,
    );
    assert(echo.welcome!.mapMeta.name === 'KESTREL YARD', 'join en cours : mapMeta KESTREL YARD');
    assert(
      echo.welcome!.phase === 'playing' || echo.welcome!.phase === 'end',
      `join en cours : phase cohérente (${echo.welcome!.phase})`,
    );

    // ---- 7. Bots serveur (2e instance SANS STRIKE_DISABLE_BOTS) ----------------------
    console.log('\n[7] Bots serveur (remplissage 4v4)');
    const server2 = startServer(PORT2, { STRIKE_MATCH_DURATION_S: '120' });
    children.push(server2);
    const botClients: TestClient[] = [];
    try {
      assert(await waitHealthz(BASE2, 10000), '2e serveur démarré');
      const solo = await connectClient('Solo', 'assault', BASE2);
      botClients.push(solo);
      const filled = await waitFor(() => solo.players.size === 8, 5000);
      assert(filled, `1 humain -> la room monte à 4v4 (${solo.players.size} joueurs)`);
      const bots = [...solo.players.values()].filter((p) => p.bot);
      assert(bots.length === 7, `7 bots dans la room (${bots.length})`);
      assert(bots.every((b) => b.name.startsWith('BOT-')), 'noms « BOT-xxx »');
      const botJoins = solo.joins.filter((j) => j.ev.player.bot).length;
      assert(botJoins >= 7, `ev join avec bot: true (${botJoins})`);
      const perTeam = [0, 1].map((t) => [...solo.players.values()].filter((p) => p.team === t).length);
      assert(perTeam[0] === 4 && perTeam[1] === 4, `équipes 4v4 (${perTeam[0]}v${perTeam[1]})`);

      for (const n of ['H2', 'H3', 'H4', 'H5']) {
        botClients.push(await connectClient(n, 'cqc', BASE2));
      }
      const shrunk = await waitFor(
        () => [...solo.players.values()].filter((p) => p.bot).length <= 4,
        6000,
      );
      assert(shrunk, 'des bots partent quand des humains arrivent dans une équipe pleine');
      const botLeaves = solo.leaves.filter((l) => solo.botIds.has(l.ev.id)).length;
      assert(botLeaves >= 3, `au moins 3 bots retirés (${botLeaves})`);
      const humansOk = await waitFor(
        () => [...solo.players.values()].filter((p) => !p.bot).length === 5,
        3000,
      );
      const humans = [...solo.players.values()].filter((p) => !p.bot).length;
      assert(humansOk, `5 humains dans la room (${humans})`);
    } finally {
      for (const c of botClients) c.close();
      try {
        server2.kill('SIGTERM');
      } catch {
        /* ignoré */
      }
    }
    // ---- 8. Transport HTTP de secours (/io) --------------------------------
    console.log('\n[8] Transport HTTP de secours (/io)');
    // a) Le préfixe de proxy est toléré (suffixe /io/join).
    const prefJoin = await fetch(`${BASE}/apps/strike/io/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert(prefJoin.ok, 'POST /apps/strike/io/join (préfixe toléré) -> 200');
    const prefSid = ((await prefJoin.json()) as { sid: string }).sid;
    await fetch(`${BASE}/io/leave?sid=${prefSid}`, { method: 'POST' });

    // b) Session complète : join -> hello -> welcome -> snapshots -> déplacement -> leave.
    const joinRes = await fetch(`${BASE}/io/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert(joinRes.ok, 'POST /io/join -> 200');
    const sid = ((await joinRes.json()) as { sid: string }).sid;
    assert(typeof sid === 'string' && sid.length > 0, 'sid reçu');

    const ioSend = async (msgs: unknown[]): Promise<boolean> => {
      const r = await fetch(`${BASE}/io/send?sid=${encodeURIComponent(sid)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgs: msgs.map((m) => JSON.stringify(m)) }),
      });
      return r.ok;
    };
    assert(await ioSend([{ t: 'hello', name: 'HttpBot', classId: 'assault' }]), 'hello via /io/send accepté');

    let httpId = -1;
    let httpWelcomed = false;
    let httpSnaps = 0;
    let selfFirst: number[] | null = null;
    let selfLast: number[] | null = null;
    let poll404 = false;
    let pollStop = false;
    const pollLoop = (async () => {
      while (!pollStop) {
        try {
          const r = await fetch(`${BASE}/io/poll?sid=${encodeURIComponent(sid)}`, { cache: 'no-store' });
          if (r.status === 404) {
            poll404 = true;
            return;
          }
          if (!r.ok) continue;
          const data = (await r.json()) as { msgs?: unknown };
          for (const raw of (data.msgs ?? []) as unknown[]) {
            if (typeof raw !== 'string') continue;
            const m = JSON.parse(raw) as { t: string; id?: number; pl?: number[][] };
            if (m.t === 'welcome' && typeof m.id === 'number') {
              httpWelcomed = true;
              httpId = m.id;
            }
            if (m.t === 'snap' && Array.isArray(m.pl)) {
              httpSnaps++;
              const me = m.pl.find((e) => e[0] === httpId);
              if (me) {
                if (selfFirst === null) selfFirst = [me[1], me[2], me[3]];
                selfLast = [me[1], me[2], me[3]];
              }
            }
          }
        } catch {
          /* réseau de test : réessayer */
        }
      }
    })();

    assert(
      await waitFor(() => httpWelcomed, 4000),
      'welcome reçu via long-poll HTTP',
    );
    // Inputs de déplacement pendant ~1,5 s (avant + sprint, yaw 0).
    let seq = 0;
    const moveUntil = Date.now() + 1500;
    while (Date.now() < moveUntil) {
      await ioSend([{ t: 'input', seq: ++seq, dt: 1 / 20, yaw: 0, pitch: 0, keys: 1 | 64 }]);
      await sleep(50);
    }
    assert(
      await waitFor(() => httpSnaps >= 10, 4000),
      `snapshots reçus via long-poll (${httpSnaps})`,
    );
    const moved =
      selfFirst !== null && selfLast !== null
        ? Math.hypot(selfLast[0] - selfFirst[0], selfLast[2] - selfFirst[2])
        : 0;
    assert(moved > 0.5, `le joueur HTTP se déplace (${moved.toFixed(2)} m)`);
    assert(
      await waitFor(
        () => clients[0].joins.some((j) => j.ev.player.name === 'HttpBot'),
        3000,
      ),
      'ev join HttpBot vu par les clients WebSocket',
    );

    // leave -> poll suivant = 404, et les clients WS voient le départ.
    await fetch(`${BASE}/io/leave?sid=${encodeURIComponent(sid)}`, { method: 'POST' });
    assert(
      await waitFor(() => poll404, 4000),
      'session fermée : poll -> 404 après leave',
    );
    assert(
      await waitFor(() => clients[0].leaves.some((l) => l.ev.id === httpId), 4000),
      'ev leave HttpBot vu par les clients WebSocket',
    );
    pollStop = true;
    await pollLoop;
  } finally {
    for (const c of clients) c.close();
    killChildren();
    await sleep(300);
  }

  console.log(`\n=== Résultat : ${passed} assertions OK, ${failed} échec(s) ===`);
  process.exit(failed === 0 ? 0 : 1);
}

// Watchdog global : ne jamais rester bloqué.
setTimeout(() => {
  console.error('TIMEOUT global du test E2E');
  killChildren();
  process.exit(1);
}, 170000);

main().catch((err) => {
  console.error('Erreur fatale du test E2E :', err);
  killChildren();
  process.exit(1);
});
