// ============================================================================
// STRIKE 2025 — server/Admin.ts
// Accès administrateur + garde-fous anti-abus du serveur public.
//  - Token admin : env ADMIN_TOKEN prioritaire, sinon auto-généré une fois et
//    persisté dans data/admin-token.txt (affiché au démarrage). Comparaison en
//    temps constant (hash sha256 des deux côtés).
//  - RateLimiter : fenêtre fixe par clé (IP), coût paramétrable (1 requête ou
//    n octets) — purement en mémoire, remis à zéro au redémarrage.
//  - clientIp : premier X-Forwarded-For si présent (derrière un proxy
//    d'hébergeur), sinon adresse du socket.
// ============================================================================

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'admin-token.txt');

function loadOrCreateToken(): string {
  const env = process.env.ADMIN_TOKEN;
  if (typeof env === 'string' && env.trim().length >= 8) return env.trim();
  try {
    if (existsSync(TOKEN_FILE)) {
      const t = readFileSync(TOKEN_FILE, 'utf8').trim();
      if (t.length >= 8) return t;
    }
  } catch {
    /* fichier illisible : régénéré ci-dessous */
  }
  const t = randomBytes(18).toString('base64url');
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(TOKEN_FILE, `${t}\n`, 'utf8');
  } catch (err) {
    console.error('[admin] impossible de persister le token :', err);
  }
  return t;
}

/** Token admin effectif du process (stable tant que data/ persiste). */
export const ADMIN_TOKEN = loadOrCreateToken();

/** À appeler au démarrage : indique où trouver le code admin (jamais en
 *  entier dans les logs d'un hébergeur — seulement sa provenance). */
export function logAdminTokenHint(): void {
  const fromEnv = typeof process.env.ADMIN_TOKEN === 'string' && process.env.ADMIN_TOKEN.trim().length >= 8;
  console.log(
    fromEnv
      ? '[admin] code admin : variable d’environnement ADMIN_TOKEN'
      : `[admin] code admin auto-généré dans ${TOKEN_FILE} (définissez ADMIN_TOKEN pour le remplacer)`,
  );
}

/** Comparaison en temps constant (les hashs égalisent les longueurs). */
export function isAdminToken(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 256) return false;
  const a = createHash('sha256').update(raw).digest();
  const b = createHash('sha256').update(ADMIN_TOKEN).digest();
  return timingSafeEqual(a, b);
}

/** Extrait le token admin d'une requête (en-tête x-admin-token). */
export function isAdminReq(req: IncomingMessage): boolean {
  return isAdminToken(req.headers['x-admin-token']);
}

/** IP client : premier X-Forwarded-For (proxy d'hébergeur) sinon socket. */
export function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0].trim();
    if (first.length > 0 && first.length <= 64) return first;
  }
  return req.socket.remoteAddress ?? 'inconnu';
}

/** Limiteur à fenêtre fixe : au plus `max` unités de coût par `windowMs`
 *  et par clé. hit() retourne false quand la limite est dépassée. */
export class RateLimiter {
  private readonly hits = new Map<string, { n: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  hit(key: string, cost = 1): boolean {
    const now = Date.now();
    // Purge paresseuse (borne mémoire même sous scan d'IPs).
    if (this.hits.size > 5000) {
      for (const [k, e] of this.hits) {
        if (now >= e.resetAt) this.hits.delete(k);
      }
    }
    let e = this.hits.get(key);
    if (!e || now >= e.resetAt) {
      e = { n: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.n += cost;
    return e.n <= this.max;
  }
}
