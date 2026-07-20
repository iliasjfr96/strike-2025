// ============================================================================
// STRIKE 2025 — AdminScreen.tsx
// Panel d'administration du serveur : réservé au détenteur du code admin
// (variable ADMIN_TOKEN de l'hébergeur, ou data/admin-token.txt).
//  - Salons ouverts : occupation + fermeture forcée
//  - Maps publiées : inspection rapide + suppression
//  - Salon principal : résumé du pack + réinitialisation map de base
//  - Fichiers importés : volumétrie + purge des orphelins
// Le code validé est conservé en localStorage : il sert aussi à autoriser la
// sauvegarde du salon principal depuis l'éditeur.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameUI } from '../ui/store';
import { Panel, TacticalButton } from '../ui/components';

const TOKEN_KEY = 'strike-admin-token';

interface Overview {
  stats?: {
    totalSessions: number;
    uniquePlayers: number;
    today: number;
    last7: { day: string; sessions: number }[];
  };
  rooms: { id: string; name: string; mapName: string; humans: number; bots: number; phase: string }[];
  maps: { slug: string; name: string; author: string; createdAt: number; objectCount: number; baseEditCount: number }[];
  uploads: { models: { count: number; bytes: number }; textures: { count: number; bytes: number } };
  main: { objects: number; baseEdits: number; props: number; weaponMods: number; baseTerrain: string };
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

/** fetch avec le code admin en en-tête. */
async function adminFetch(pathname: string, token: string, body?: unknown): Promise<Response> {
  return fetch(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify(body ?? {}),
  });
}

export default function AdminScreen() {
  const engineSetPhase = useGameUI((s) => s.engineSetPhase);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [authed, setAuthed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [data, setData] = useState<Overview | null>(null);

  const refresh = useCallback(async (tok: string): Promise<boolean> => {
    try {
      const res = await fetch('/admin/overview', {
        method: 'GET',
        headers: { 'x-admin-token': tok },
      });
      if (!res.ok) return false;
      const json = (await res.json()) as Overview & { ok: boolean };
      if (!json.ok) return false;
      setData(json);
      return true;
    } catch {
      return false;
    }
  }, []);

  const login = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const okAuth = await adminFetch('/admin/check', token).then((r) => r.ok).catch(() => false);
    if (!okAuth) {
      setBusy(false);
      setMsg('CODE REFUSÉ (voir la console serveur ou la variable ADMIN_TOKEN)');
      return;
    }
    localStorage.setItem(TOKEN_KEY, token);
    setAuthed(true);
    await refresh(token);
    setBusy(false);
  }, [busy, token, refresh]);

  // Code déjà mémorisé : tentative de connexion silencieuse.
  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      void refresh(saved).then((ok) => setAuthed(ok));
    }
  }, [refresh]);

  const act = async (label: string, pathname: string, body?: unknown): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch(pathname, token, body);
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; removed?: number; freedBytes?: number };
      if (res.ok && json.ok) {
        setMsg(
          typeof json.removed === 'number'
            ? `${label} : ${json.removed} fichier(s) supprimé(s), ${mb(json.freedBytes ?? 0)} libérés`
            : `${label} : OK`,
        );
      } else {
        setMsg(`${label} : ÉCHEC — ${json.error ?? `HTTP ${res.status}`}`);
      }
    } catch {
      setMsg(`${label} : ÉCHEC — serveur injoignable`);
    }
    await refresh(token);
    setBusy(false);
  };

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-[rgba(4,7,10,0.92)] font-hud">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mx-auto my-8 w-[720px] max-w-[95vw]"
      >
        <Panel>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-semibold uppercase tracking-[0.2em] text-amber">/// ADMINISTRATION</p>
              <TacticalButton onClick={() => engineSetPhase('menu')}>RETOUR</TacticalButton>
            </div>

            {!authed && (
              <div className="mt-4">
                <p className="text-[12px] uppercase tracking-[0.1em] text-text-mid">
                  Code admin du serveur (variable d'environnement ADMIN_TOKEN, ou fichier
                  data/admin-token.txt affiché au démarrage du serveur).
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void login();
                    }}
                    placeholder="CODE ADMIN"
                    className="chamfer-6 w-[280px] border border-line bg-[rgba(6,9,12,0.7)] px-2 py-1.5 text-[13px] tracking-[0.1em] text-text-hi outline-none placeholder:text-text-dim focus:border-line-strong"
                  />
                  <TacticalButton variant="primary" onClick={() => void login()}>
                    {busy ? '…' : 'SE CONNECTER'}
                  </TacticalButton>
                </div>
              </div>
            )}

            {msg && <p className="mt-3 text-[12px] uppercase tracking-[0.1em] text-amber">{msg}</p>}

            {authed && data && (
              <>
                {/* ---- Fréquentation ---- */}
                {data.stats && (
                  <div className="mt-5 border-t border-line pt-4">
                    <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-text-hi">
                      FRÉQUENTATION
                    </p>
                    <div className="mt-2 flex gap-3">
                      {(
                        [
                          [data.stats.uniquePlayers, 'JOUEURS UNIQUES'],
                          [data.stats.totalSessions, 'SESSIONS DE JEU'],
                          [data.stats.today, "AUJOURD'HUI"],
                        ] as [number, string][]
                      ).map(([value, label]) => (
                        <div
                          key={label}
                          className="chamfer-6 flex-1 border border-line bg-[rgba(13,19,26,0.6)] px-3 py-2 text-center"
                        >
                          <p className="font-display text-[22px] font-bold text-amber [font-variant-numeric:tabular-nums]">
                            {value.toLocaleString('fr-FR')}
                          </p>
                          <p className="text-[9px] uppercase tracking-[0.16em] text-text-dim">{label}</p>
                        </div>
                      ))}
                    </div>
                    {data.stats.last7.length > 0 && (
                      <div className="mt-2 flex items-end gap-1.5">
                        {data.stats.last7.map((d) => {
                          const max = Math.max(...data.stats!.last7.map((x) => x.sessions), 1);
                          return (
                            <div key={d.day} className="flex flex-1 flex-col items-center gap-0.5">
                              <span className="text-[9px] text-text-mid [font-variant-numeric:tabular-nums]">
                                {d.sessions}
                              </span>
                              <span
                                className="w-full bg-[rgba(245,158,31,0.45)]"
                                style={{ height: `${Math.max(3, Math.round((d.sessions / max) * 36))}px` }}
                              />
                              <span className="text-[8px] uppercase text-text-dim">{d.day.slice(5)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-text-dim">
                      1 session = 1 connexion à une partie · joueurs uniques par empreinte anonyme
                    </p>
                  </div>
                )}

                {/* ---- Salons ---- */}
                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-text-hi">
                    SALONS OUVERTS ({data.rooms.length}/12)
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {data.rooms.map((r) => (
                      <div
                        key={r.id}
                        className="chamfer-6 flex items-center justify-between border border-line bg-[rgba(13,19,26,0.6)] px-2 py-1.5"
                      >
                        <span className="text-[12px] uppercase tracking-[0.08em] text-text-hi">
                          {r.name}
                          <span className="ml-2 text-[10px] text-text-dim">
                            {r.mapName} · {r.humans} joueur(s) + {r.bots} bot(s) · {r.phase}
                          </span>
                        </span>
                        {r.id !== 'main' && (
                          <TacticalButton
                            onClick={() => {
                              if (window.confirm(`Fermer le salon « ${r.name} » et déconnecter ses joueurs ?`)) {
                                void act('Fermeture du salon', '/admin/rooms/close', { id: r.id });
                              }
                            }}
                          >
                            FERMER
                          </TacticalButton>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* ---- Maps publiées ---- */}
                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-text-hi">
                    MAPS PUBLIÉES ({data.maps.length}/100)
                  </p>
                  {data.maps.length === 0 && (
                    <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-text-dim">AUCUNE MAP PUBLIÉE</p>
                  )}
                  <div className="mt-2 flex flex-col gap-1.5">
                    {data.maps.map((m) => (
                      <div
                        key={m.slug}
                        className="chamfer-6 flex items-center justify-between border border-line bg-[rgba(13,19,26,0.6)] px-2 py-1.5"
                      >
                        <span className="text-[12px] uppercase tracking-[0.08em] text-text-hi">
                          {m.name}
                          <span className="ml-2 text-[10px] text-text-dim">
                            par {m.author} · {m.objectCount} objet(s) · {m.baseEditCount} édition(s) ·{' '}
                            {m.createdAt > 0 ? new Date(m.createdAt).toLocaleDateString('fr-FR') : '—'}
                          </span>
                        </span>
                        <span className="flex gap-2">
                          <TacticalButton
                            onClick={() => {
                              if (window.confirm(`Supprimer définitivement la map « ${m.name} » ?`)) {
                                void act('Suppression de la map', '/admin/maps/delete', { slug: m.slug });
                              }
                            }}
                          >
                            SUPPRIMER
                          </TacticalButton>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-text-dim">
                    Pour inspecter une map en jeu : COMMUNAUTÉ → créer un salon avec cette map.
                  </p>
                </div>

                {/* ---- Salon principal ---- */}
                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-text-hi">SALON PRINCIPAL</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-text-mid">
                    {data.main.objects} objet(s) · {data.main.baseEdits} édition(s) de base · {data.main.props} objet(s)
                    importé(s) · {data.main.weaponMods} arme(s) modifiée(s) · terrain {data.main.baseTerrain}
                  </p>
                  <div className="mt-2">
                    <TacticalButton
                      onClick={() => {
                        if (window.confirm('Réinitialiser la map du salon principal (retour à la map de base) ?')) {
                          void act('Réinitialisation du salon principal', '/admin/main/reset');
                        }
                      }}
                    >
                      RÉINITIALISER LA MAP PRINCIPALE
                    </TacticalButton>
                  </div>
                </div>

                {/* ---- Fichiers importés ---- */}
                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-text-hi">FICHIERS IMPORTÉS</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-text-mid">
                    {data.uploads.models.count} modèle(s) 3D ({mb(data.uploads.models.bytes)}) ·{' '}
                    {data.uploads.textures.count} texture(s) ({mb(data.uploads.textures.bytes)})
                  </p>
                  <div className="mt-2">
                    <TacticalButton
                      onClick={() => {
                        if (
                          window.confirm(
                            'Supprimer tous les fichiers importés qui ne sont utilisés par aucune map ni aucun salon ? (à éviter pendant qu’un joueur importe)',
                          )
                        ) {
                          void act('Purge des fichiers orphelins', '/admin/uploads/prune');
                        }
                      }}
                    >
                      PURGER LES FICHIERS ORPHELINS
                    </TacticalButton>
                  </div>
                </div>

                <div className="mt-5 border-t border-line pt-3">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-text-dim">
                    Ce code autorise aussi la sauvegarde du salon principal depuis l'éditeur de map. Les joueurs sans
                    code peuvent toujours créer, publier et jouer leurs propres maps.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <TacticalButton onClick={() => void refresh(token)}>{busy ? '…' : 'ACTUALISER'}</TacticalButton>
                    <TacticalButton
                      onClick={() => {
                        localStorage.removeItem(TOKEN_KEY);
                        setAuthed(false);
                        setData(null);
                        setToken('');
                      }}
                    >
                      SE DÉCONNECTER
                    </TacticalButton>
                  </div>
                </div>
              </>
            )}
          </div>
        </Panel>
      </motion.div>
    </div>
  );
}
