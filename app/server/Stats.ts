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
  totalSessions: number;
  /** hash(IP) -> timestamp (ms) de la PREMIÈRE venue. */
  players: Record<string, number>;
  /** 'YYYY-MM-DD' -> nombre de sessions ce jour-là. */
  days: Record<string, number>;
}

function load(): StatsFile {
  try {
    if (existsSync(FILE)) {
      const raw = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<StatsFile>;
      return {
        totalSessions: typeof raw.totalSessions === 'number' ? raw.totalSessions : 0,
        players: typeof raw.players === 'object' && raw.players !== null ? raw.players : {},
        days: typeof raw.days === 'object' && raw.days !== null ? raw.days : {},
      };
    }
  } catch (err) {
    console.error('[stats] fichier illisible (repart de zéro) :', err);
  }
  return { totalSessions: 0, players: {}, days: {} };
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

/** Enregistre une session de jeu (appelé à chaque connexion WebSocket /ws). */
export function recordSession(ip: string): void {
  stats.totalSessions++;
  const h = createHash('sha1').update(SALT + ip).digest('hex').slice(0, 16);
  if (!(h in stats.players)) stats.players[h] = Date.now();
  const day = today();
  stats.days[day] = (stats.days[day] ?? 0) + 1;
  // Élague l'historique au-delà de MAX_DAYS.
  const keys = Object.keys(stats.days).sort();
  while (keys.length > MAX_DAYS) {
    const k = keys.shift();
    if (k) delete stats.days[k];
  }
  scheduleSave();
}

/** Résumé pour le panel admin. */
export function playStats(): {
  totalSessions: number;
  uniquePlayers: number;
  today: number;
  last7: { day: string; sessions: number }[];
} {
  const days = Object.keys(stats.days).sort().slice(-7);
  return {
    totalSessions: stats.totalSessions,
    uniquePlayers: Object.keys(stats.players).length,
    today: stats.days[today()] ?? 0,
    last7: days.map((day) => ({ day, sessions: stats.days[day] })),
  };
}
