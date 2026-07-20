// ============================================================================
// STRIKE 2025 — server/Stats.ts
// Statistiques de fréquentation PERSISTANTES (data/stats.json) :
//  - sessions de jeu (une connexion WebSocket = quelqu'un a lancé une partie)
//  - joueurs uniques (par HASH d'IP salé — aucune IP en clair sur le disque)
//  - sessions par jour (60 derniers jours conservés)
// Écriture différée (5 s) et atomique. Consommé par /admin/overview.
// ============================================================================

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'stats.json');
/** Sel du hash d'IP (anonymisation — les IP ne sont jamais stockées). */
const SALT = 'strike-stats-v1:';
/** Jours d'historique conservés. */
const MAX_DAYS = 60;

interface StatsFile {
  /** Sessions de JEU (connexions à une partie). */
  totalSessions: number;
  /** hash(IP) -> 1re venue — personnes ayant LANCÉ une partie. */
  players: Record<string, number>;
  /** 'YYYY-MM-DD' -> sessions de jeu ce jour-là. */
  days: Record<string, number>;
  /** Chargements du site (page ouverte, partie lancée ou non). */
  totalVisits: number;
  /** hash(IP) -> 1re venue — personnes ayant OUVERT le site. */
  visitors: Record<string, number>;
  /** 'YYYY-MM-DD' -> visites ce jour-là. */
  visitDays: Record<string, number>;
}

function load(): StatsFile {
  const empty: StatsFile = {
    totalSessions: 0,
    players: {},
    days: {},
    totalVisits: 0,
    visitors: {},
    visitDays: {},
  };
  try {
    if (existsSync(FILE)) {
      const raw = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<StatsFile>;
      const obj = (v: unknown): Record<string, number> =>
        typeof v === 'object' && v !== null ? (v as Record<string, number>) : {};
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      return {
        totalSessions: num(raw.totalSessions),
        players: obj(raw.players),
        days: obj(raw.days),
        totalVisits: num(raw.totalVisits),
        visitors: obj(raw.visitors),
        visitDays: obj(raw.visitDays),
      };
    }
  } catch (err) {
    console.error('[stats] fichier illisible (repart de zéro) :', err);
  }
  return empty;
}

const stats = load();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      writeFileSync(tmp, JSON.stringify(stats), 'utf8');
      renameSync(tmp, FILE);
    } catch (err) {
      console.error('[stats] échec de sauvegarde :', err);
    }
  }, 5000);
  saveTimer.unref?.();
}

/** Jour courant (UTC) au format YYYY-MM-DD. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Empreinte anonyme d'une IP (jamais stockée en clair). */
function fingerprint(ip: string): string {
  return createHash('sha1').update(SALT + ip).digest('hex').slice(0, 16);
}

/** Élague un historique journalier au-delà de MAX_DAYS. */
function pruneDays(map: Record<string, number>): void {
  const keys = Object.keys(map).sort();
  while (keys.length > MAX_DAYS) {
    const k = keys.shift();
    if (k) delete map[k];
  }
}

/** Enregistre une session de jeu (appelé à chaque connexion WebSocket /ws). */
export function recordSession(ip: string): void {
  stats.totalSessions++;
  const h = fingerprint(ip);
  if (!(h in stats.players)) stats.players[h] = Date.now();
  const day = today();
  stats.days[day] = (stats.days[day] ?? 0) + 1;
  pruneDays(stats.days);
  scheduleSave();
}

/**
 * Enregistre une VISITE du site (chargement de la page — que la personne
 * lance une partie ensuite ou non). Appelé au service de index.html.
 */
export function recordVisit(ip: string): void {
  stats.totalVisits++;
  const h = fingerprint(ip);
  if (!(h in stats.visitors)) stats.visitors[h] = Date.now();
  const day = today();
  stats.visitDays[day] = (stats.visitDays[day] ?? 0) + 1;
  pruneDays(stats.visitDays);
  scheduleSave();
}

/** Vrai si la requête ressemble à un robot/scanner (non compté). Un VPS
 *  public reçoit en permanence des crawlers — sinon les chiffres mentent. */
export function looksLikeBot(userAgent: string | undefined): boolean {
  if (!userAgent) return true; // aucun UA : jamais un vrai navigateur
  return /bot|crawler|spider|slurp|curl|wget|python|scan|monitor|preview|headless|facebookexternalhit|embed/i.test(
    userAgent,
  );
}

/** Résumé pour le panel admin (visites du site + parties jouées). */
export function playStats(): {
  totalSessions: number;
  uniquePlayers: number;
  today: number;
  totalVisits: number;
  uniqueVisitors: number;
  todayVisits: number;
  last7: { day: string; sessions: number; visits: number }[];
} {
  // 7 derniers jours ayant une visite OU une partie.
  const days = [...new Set([...Object.keys(stats.days), ...Object.keys(stats.visitDays)])]
    .sort()
    .slice(-7);
  const d = today();
  return {
    totalSessions: stats.totalSessions,
    uniquePlayers: Object.keys(stats.players).length,
    today: stats.days[d] ?? 0,
    totalVisits: stats.totalVisits,
    uniqueVisitors: Object.keys(stats.visitors).length,
    todayVisits: stats.visitDays[d] ?? 0,
    last7: days.map((day) => ({
      day,
      sessions: stats.days[day] ?? 0,
      visits: stats.visitDays[day] ?? 0,
    })),
  };
}
