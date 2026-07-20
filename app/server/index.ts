// ============================================================================
// STRIKE 2025 — server/index.ts
// Point d'entrée du serveur autoritaire.
//  - HTTP : fichiers statiques depuis dist/, fallback SPA (toute route
//    inconnue hors /ws et /healthz -> dist/index.html), GET /healthz -> 200 « ok ».
//  - WebSocket : upgrade accepté UNIQUEMENT sur /ws (sinon socket.destroy()),
//    géré via server.on('upgrade') + ws en mode noServer.
//  - Écoute 0.0.0.0, PORT = process.env.PORT || DEFAULT_PORT (3000).
// ============================================================================

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, WS_PATH } from '../src/shared/protocol.js';
import { RateLimiter, clientIp, isAdminReq, logAdminTokenHint } from './Admin.js';
import { attachGame } from './attach.js';
import { loadMainMapState, saveMainMapState } from './CustomMap.js';
import { deleteMap, listMaps, loadMap, publishMap } from './MapLibrary.js';

// État d'édition du salon principal (chargé avant la création des salons).
const MAIN_MAP_STATE = loadMainMapState();

// ---------------------------------------------------------------------------
// Garde-fous anti-abus (par IP, fenêtres de 10 min, en mémoire)
// ---------------------------------------------------------------------------

const WINDOW_MS = 10 * 60_000;
/** Uploads : au plus 30 fichiers ET 64 Mo par IP par fenêtre. */
const uploadCountLimit = new RateLimiter(30, WINDOW_MS);
const uploadBytesLimit = new RateLimiter(64 * 1024 * 1024, WINDOW_MS);
/** Publications de maps : 5 par IP par fenêtre. */
const publishLimit = new RateLimiter(5, WINDOW_MS);
/** Créations de salons : 6 par IP par fenêtre. */
const roomLimit = new RateLimiter(6, WINDOW_MS);
/** Tentatives de code admin : 20 par IP par fenêtre (anti force brute). */
const adminTryLimit = new RateLimiter(20, WINDOW_MS);

function reply429(res: import('node:http').ServerResponse): void {
  res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'trop de requêtes — réessayez dans quelques minutes' }));
}

function reply401(res: import('node:http').ServerResponse): void {
  res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'code admin requis' }));
}

/** Auth admin d'une requête, avec limite anti force brute. false = réponse
 *  déjà envoyée (401/429), l'appelant doit juste return. */
function requireAdmin(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): boolean {
  if (!adminTryLimit.hit(clientIp(req))) {
    reply429(res);
    return false;
  }
  if (!isAdminReq(req)) {
    reply401(res);
    return false;
  }
  return true;
}

/** Statistiques d'un dossier d'uploads (nombre + octets). */
function dirStats(dir: string): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  try {
    for (const f of readdirSync(dir)) {
      try {
        const st = statSync(path.join(dir, f));
        if (st.isFile()) {
          count++;
          bytes += st.size;
        }
      } catch {
        /* fichier disparu entre-temps */
      }
    }
  } catch {
    /* dossier absent */
  }
  return { count, bytes };
}

// ---------------------------------------------------------------------------
// Répertoire statique (dist/ produit par `npm run build`)
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_CANDIDATES = [
  path.resolve(here, '../dist'), // dist-server/index.js -> ../dist
  path.resolve(process.cwd(), 'dist'),
];
const DIST_DIR =
  DIST_CANDIDATES.find((d) => existsSync(path.join(d, 'index.html'))) ?? DIST_CANDIDATES[0];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Lit + parse un corps JSON ; répond 413/400 et retourne undefined si KO. */
async function readJson(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<unknown> {
  const body = await readBody(req, 1024 * 1024);
  if (body === null) {
    res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('payload trop grand');
    return undefined;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('JSON invalide');
    return undefined;
  }
}

/** Types MIME des modèles servis. */
const MODEL_MIME: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  fbx: 'application/octet-stream',
  obj: 'model/obj',
  stl: 'model/stl',
};

/**
 * Détecte le format d'un modèle 3D par son EMPREINTE (jamais l'extension) :
 *  - GLB  : magic « glTF » en tête
 *  - FBX  : « Kaydara FBX Binary » (binaire) ou FBXHeaderExtension (ASCII)
 *  - STL  : binaire (84 + n×50 octets exactement) ou ASCII « solid »
 *  - GLTF : JSON avec un champ "asset"
 *  - OBJ  : texte avec sommets `v x y z` et faces `f …`
 * Retourne null si aucun format reconnu.
 */
function sniffModelFormat(buf: Buffer): 'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | null {
  if (buf.length < 16) return null;
  if (buf.toString('ascii', 0, 4) === 'glTF') return 'glb';
  if (buf.toString('ascii', 0, 18) === 'Kaydara FBX Binary') return 'fbx';
  // STL binaire : taille = 84 + nTriangles × 50 (vérification forte).
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (n > 0 && buf.length === 84 + n * 50) return 'stl';
  }
  // Formats texte : on inspecte le fichier ENTIER (les faces d'un OBJ et le
  // champ "asset" d'un GLTF peuvent être tout à la fin — un extrait tronqué
  // faisait rejeter des fichiers valides).
  const text = buf.toString('utf8');
  if (text.slice(0, 65536).includes('FBXHeaderExtension')) return 'fbx';
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') && text.includes('"asset"')) return 'gltf';
  if (/^\s*solid/.test(trimmed) && text.includes('facet')) return 'stl';
  if (/^\s*(v|o|g|mtllib)\s/m.test(text.slice(0, 8192)) && /^\s*f\s+\d/m.test(text)) {
    return 'obj';
  }
  return null;
}

/** Détecte le format d'une image par magic bytes (PNG / JPEG / WebP). */
function sniffImageFormat(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.length < 16) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Lit un corps BINAIRE (upload de modèle) — null si dépassement. */
function readBinary(req: import('node:http').IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

/** Lit le corps d'une requête (cap de taille) — null si dépassement. */
function readBody(req: import('node:http').IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/** Résout un chemin URL vers un fichier de dist/ (anti-traversal), ou null. */
function resolveStatic(pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const normalized = path.normalize(rel).replace(/^([/\\])+/, '');
  const filePath = path.join(DIST_DIR, normalized);
  if (!filePath.startsWith(DIST_DIR + path.sep) && filePath !== DIST_DIR) return null;
  try {
    if (statSync(filePath).isFile()) return filePath;
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Serveur HTTP
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  void (async () => {
    try {
      // Transport de secours 100 % HTTP (proxy sans WebSocket) : /io/*.
      if (await ioHandler(req, res)) return;

      const u = new URL(req.url ?? '/', 'http://localhost');
      const pathname = u.pathname;

      // Sonde de santé.
      if (req.method === 'GET' && pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('ok');
        return;
      }

      // Éditeur de map : lecture / sauvegarde de l'état du SALON PRINCIPAL.
      if (pathname === '/mapedit/objects' || pathname.endsWith('/mapedit/objects')) {
        if (req.method === 'GET') {
          const s = attachment.rooms.main.game.mapState;
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ objects: s.objects, baseEdits: s.baseEdits, weaponMods: s.weaponMods ?? {}, loadouts: s.loadouts ?? {}, props: s.props ?? [], baseTerrain: s.baseTerrain ?? 'kestrel' }));
          return;
        }
        if (req.method === 'POST') {
          // La map du salon principal est commune à tous : sa modification est
          // réservée à l'admin (les joueurs publient leurs maps à la place).
          if (!requireAdmin(req, res)) return;
          const parsed = await readJson(req, res);
          if (parsed === undefined) return;
          const p = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
          const state = saveMainMapState(p.objects, p.baseEdits, p.weaponMods, p.loadouts, p.props, p.baseTerrain);
          // Application au salon principal + diffusion live à ses joueurs.
          attachment.rooms.main.game.applyMap(state);
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(
            JSON.stringify({ ok: true, count: state.objects.length, baseEdits: state.baseEdits.length }),
          );
          return;
        }
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }

      // Bibliothèque de maps de la communauté : liste + publication.
      if (pathname === '/mapedit/maps' || pathname.endsWith('/mapedit/maps')) {
        if (req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ maps: listMaps() }));
          return;
        }
        if (req.method === 'POST') {
          if (!publishLimit.hit(clientIp(req))) {
            reply429(res);
            return;
          }
          const parsed = await readJson(req, res);
          if (parsed === undefined) return;
          const p = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
          const published = publishMap(p.name, p.author, p.objects, p.baseEdits, p.weaponMods, p.loadouts, p.props, p.baseTerrain);
          if (published === null) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'map vide ou bibliothèque pleine' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, slug: published.slug, name: published.name }));
          return;
        }
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }

      // Modèles 3D custom (armurerie) : upload + service des GLB validés.
      if (pathname === '/mods/models' || pathname.endsWith('/mods/models')) {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('method not allowed');
          return;
        }
        const ip = clientIp(req);
        if (!uploadCountLimit.hit(ip)) {
          reply429(res);
          return;
        }
        const buf = await readBinary(req, 16 * 1024 * 1024);
        if (buf === null) {
          res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('fichier trop grand (max 16 Mo)');
          return;
        }
        if (!uploadBytesLimit.hit(ip, buf.length)) {
          reply429(res);
          return;
        }
        // Format détecté par EMPREINTE (jamais par extension déclarée).
        const fmt = sniffModelFormat(buf);
        if (fmt === null) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          res.end(
            JSON.stringify({
              ok: false,
              error: 'format invalide — GLB (recommandé), GLTF embarqué, FBX, OBJ ou STL attendu',
            }),
          );
          return;
        }
        const hash = createHash('sha1').update(buf).digest('hex');
        const dir = path.resolve(process.cwd(), 'data', 'models');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${hash}.${fmt}`), buf);
        console.log(`[mods] modèle uploadé : ${hash}.${fmt} (${(buf.length / 1024).toFixed(0)} Ko)`);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, file: `/mods/models/${hash}.${fmt}`, format: fmt }));
        return;
      }
      // Textures custom (armurerie) : upload + service.
      if (pathname === '/mods/textures' || pathname.endsWith('/mods/textures')) {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('method not allowed');
          return;
        }
        const ip = clientIp(req);
        if (!uploadCountLimit.hit(ip)) {
          reply429(res);
          return;
        }
        const buf = await readBinary(req, 8 * 1024 * 1024);
        if (buf === null) {
          res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('fichier trop grand (max 8 Mo)');
          return;
        }
        if (!uploadBytesLimit.hit(ip, buf.length)) {
          reply429(res);
          return;
        }
        const fmt = sniffImageFormat(buf);
        if (fmt === null) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'image invalide — PNG, JPG ou WebP attendu' }));
          return;
        }
        const hash = createHash('sha1').update(buf).digest('hex');
        const dir = path.resolve(process.cwd(), 'data', 'textures');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${hash}.${fmt}`), buf);
        console.log(`[mods] texture uploadée : ${hash}.${fmt} (${(buf.length / 1024).toFixed(0)} Ko)`);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, file: `/mods/textures/${hash}.${fmt}`, format: fmt }));
        return;
      }
      {
        // Service des textures uploadées : /mods/textures/<hash>.<ext> (GET).
        const m = pathname.match(/\/mods\/textures\/([a-z0-9]{8,64}\.(png|jpg|webp))$/);
        if (m !== null) {
          if (req.method !== 'GET') {
            res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('method not allowed');
            return;
          }
          const file = path.resolve(process.cwd(), 'data', 'textures', m[1]);
          try {
            const data = await readFile(file);
            res.writeHead(200, {
              'content-type': m[2] === 'jpg' ? 'image/jpeg' : `image/${m[2]}`,
              'cache-control': 'public, max-age=31536000, immutable',
            });
            res.end(data);
          } catch {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('texture introuvable');
          }
          return;
        }
      }

      {
        // Service des modèles uploadés : /mods/models/<hash>.<ext> (GET).
        const m = pathname.match(/\/mods\/models\/([a-z0-9]{8,64}\.(glb|gltf|fbx|obj|stl))$/);
        if (m !== null) {
          if (req.method !== 'GET') {
            res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('method not allowed');
            return;
          }
          const file = path.resolve(process.cwd(), 'data', 'models', m[1]);
          try {
            const data = await readFile(file);
            res.writeHead(200, {
              'content-type': MODEL_MIME[m[2]] ?? 'application/octet-stream',
              'cache-control': 'public, max-age=31536000, immutable',
            });
            res.end(data);
          } catch {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('modèle introuvable');
          }
          return;
        }
      }

      // Salons : liste + création (avec map de bibliothèque optionnelle).
      if (pathname === '/rooms' || pathname.endsWith('/rooms')) {
        if (req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ rooms: attachment.rooms.list() }));
          return;
        }
        if (req.method === 'POST') {
          if (!roomLimit.hit(clientIp(req))) {
            reply429(res);
            return;
          }
          const parsed = await readJson(req, res);
          if (parsed === undefined) return;
          const p = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
          const mapSlug = typeof p.mapSlug === 'string' && p.mapSlug.length > 0 ? p.mapSlug : null;
          const room = attachment.rooms.create(p.name, mapSlug);
          if (room === null) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'création impossible (limite de salons ou map inconnue)' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, id: room.id, name: room.name, mapName: room.mapName }));
          return;
        }
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }

      // -----------------------------------------------------------------------
      // Panel ADMIN (toutes les routes exigent l'en-tête x-admin-token).
      // -----------------------------------------------------------------------

      // Validation du code (login du panel).
      if (pathname === '/admin/check' || pathname.endsWith('/admin/check')) {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('method not allowed');
          return;
        }
        if (!requireAdmin(req, res)) return;
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // Vue d'ensemble : salons, maps publiées, uploads, salon principal.
      if (pathname === '/admin/overview' || pathname.endsWith('/admin/overview')) {
        if (!requireAdmin(req, res)) return;
        const main = attachment.rooms.main.game.mapState;
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: true,
            rooms: attachment.rooms.list(),
            maps: listMaps(),
            uploads: {
              models: dirStats(path.resolve(process.cwd(), 'data', 'models')),
              textures: dirStats(path.resolve(process.cwd(), 'data', 'textures')),
            },
            main: {
              objects: main.objects.length,
              baseEdits: main.baseEdits.length,
              props: (main.props ?? []).length,
              weaponMods: Object.keys(main.weaponMods ?? {}).length,
              baseTerrain: main.baseTerrain ?? 'kestrel',
            },
          }),
        );
        return;
      }

      // Suppression d'une map publiée : { slug }.
      if (pathname === '/admin/maps/delete' || pathname.endsWith('/admin/maps/delete')) {
        if (!requireAdmin(req, res)) return;
        const parsed = await readJson(req, res);
        if (parsed === undefined) return;
        const p = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
        const okDel = typeof p.slug === 'string' && deleteMap(p.slug);
        res.writeHead(okDel ? 200 : 404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(okDel ? { ok: true } : { ok: false, error: 'map introuvable' }));
        return;
      }

      // Fermeture d'un salon (déconnecte ses joueurs) : { id }.
      if (pathname === '/admin/rooms/close' || pathname.endsWith('/admin/rooms/close')) {
        if (!requireAdmin(req, res)) return;
        const parsed = await readJson(req, res);
        if (parsed === undefined) return;
        const p = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
        const okClose = typeof p.id === 'string' && attachment.rooms.close(p.id);
        res.writeHead(okClose ? 200 : 404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(okClose ? { ok: true } : { ok: false, error: 'salon introuvable (ou main)' }));
        return;
      }

      // Réinitialisation de la map du salon principal (retour map de base).
      if (pathname === '/admin/main/reset' || pathname.endsWith('/admin/main/reset')) {
        if (!requireAdmin(req, res)) return;
        const state = saveMainMapState([], [], {}, {}, [], 'kestrel');
        attachment.rooms.main.game.applyMap(state);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // Purge des fichiers importés qui ne sont référencés par AUCUN pack
      // (map principale, maps publiées, salons ouverts). À éviter pendant
      // qu'un joueur est en train d'importer (fichier pas encore enregistré).
      if (pathname === '/admin/uploads/prune' || pathname.endsWith('/admin/uploads/prune')) {
        if (!requireAdmin(req, res)) return;
        const referenced = new Set<string>();
        const collect = (s: import('../src/shared/mapObjects.js').MapState): void => {
          for (const mod of Object.values(s.weaponMods ?? {})) {
            const m = mod?.model;
            if (m) {
              if (m.file) referenced.add(path.basename(m.file)); // absent = modèle d'origine
              if (m.map) referenced.add(path.basename(m.map));
              if (m.normalMap) referenced.add(path.basename(m.normalMap));
            }
          }
          for (const pr of s.props ?? []) {
            referenced.add(path.basename(pr.file));
            if (pr.map) referenced.add(path.basename(pr.map));
            if (pr.normalMap) referenced.add(path.basename(pr.normalMap));
          }
        };
        for (const r of attachment.rooms.rooms.values()) collect(r.game.mapState);
        for (const meta of listMaps()) {
          const loaded = loadMap(meta.slug);
          if (loaded) collect(loaded.state);
        }
        let removed = 0;
        let freed = 0;
        for (const sub of ['models', 'textures']) {
          const dir = path.resolve(process.cwd(), 'data', sub);
          try {
            for (const f of readdirSync(dir)) {
              if (referenced.has(f)) continue;
              try {
                const st = statSync(path.join(dir, f));
                if (!st.isFile()) continue;
                unlinkSync(path.join(dir, f));
                removed++;
                freed += st.size;
              } catch {
                /* fichier disparu */
              }
            }
          } catch {
            /* dossier absent */
          }
        }
        console.log(`[admin] purge des uploads orphelins : ${removed} fichier(s), ${(freed / 1024 / 1024).toFixed(1)} Mo`);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, removed, freedBytes: freed }));
        return;
      }

      // /ws est réservé à l'upgrade WebSocket.
      if (pathname === WS_PATH || pathname.startsWith(WS_PATH + '/')) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }

      // Fichier statique depuis dist/.
      const file = resolveStatic(pathname);
      if (file !== null) {
        const data = await readFile(file);
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
        });
        res.end(data);
        return;
      }

      // Fallback SPA : toute route inconnue renvoie dist/index.html.
      const index = await readFile(path.join(DIST_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(index);
    } catch (err) {
      console.error('[STRIKE] erreur HTTP :', err);
      try {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('erreur interne');
      } catch {
        /* réponse déjà partie : ignoré */
      }
    }
  })();
});

// ---------------------------------------------------------------------------
// Serveur de jeu (WebSocket /ws + transport HTTP /io) — attach.ts partagé
// avec le plugin Vite de dev. En production : upgrades hors /ws détruits.
// ---------------------------------------------------------------------------

const attachment = attachGame(server, { destroyUnknownUpgrades: true, mainMapState: MAIN_MAP_STATE });
const ioHandler = attachment.ioHandler;

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || DEFAULT_PORT;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[STRIKE 2025] serveur en écoute sur 0.0.0.0:${PORT} (dist: ${DIST_DIR})`);
  logAdminTokenHint();
});

// Robustesse : jamais d'exception non catchée ne doit tuer le process.
process.on('uncaughtException', (err) => {
  console.error('[STRIKE] uncaughtException :', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[STRIKE] unhandledRejection :', err);
});
