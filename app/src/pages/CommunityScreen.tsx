// ============================================================================
// STRIKE 2025 — CommunityScreen.tsx
// Écran COMMUNAUTÉ : SALONS (liste + rejoindre + créer) et MAPS publiées
// (jouer = crée un salon avec cette map et le rejoint). Le salon sélectionné
// est stocké dans le store (selectedRoom) et utilisé par GameClient.connect.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { useGameUI } from '../ui/store';
import { Panel, TacticalButton } from '../ui/components';

interface RoomInfo {
  id: string;
  name: string;
  mapName: string;
  humans: number;
  bots: number;
  phase: string;
}

interface MapInfo {
  slug: string;
  name: string;
  author: string;
  createdAt: number;
  objectCount: number;
  baseEditCount: number;
}

export default function CommunityScreen() {
  const backToMenu = useGameUI((s) => s.backToMenu);
  const goToLoadout = useGameUI((s) => s.goToLoadout);
  const setSelectedRoom = useGameUI((s) => s.setSelectedRoom);

  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [r, m] = await Promise.all([
        fetch('/rooms', { cache: 'no-store' }).then((x) => x.json()),
        fetch('/mapedit/maps', { cache: 'no-store' }).then((x) => x.json()),
      ]);
      setRooms(Array.isArray(r.rooms) ? (r.rooms as RoomInfo[]) : []);
      setMaps(Array.isArray(m.maps) ? (m.maps as MapInfo[]) : []);
      setError(null);
    } catch {
      setError('SERVEUR INJOIGNABLE');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [refresh]);

  /** Rejoint un salon existant : sélection + écran de classe. */
  const joinRoom = (room: RoomInfo): void => {
    setSelectedRoom(room.id === 'main' ? null : { id: room.id, name: room.name, mapName: room.mapName });
    goToLoadout();
  };

  /** Crée un salon (map optionnelle) puis le rejoint. */
  const createRoom = async (mapSlug: string | null, name: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, mapSlug }),
      });
      const data = (await res.json()) as { ok?: boolean; id?: string; name?: string; mapName?: string };
      if (!res.ok || !data.ok || !data.id) {
        setError('CRÉATION IMPOSSIBLE (LIMITE DE SALONS ?)');
        return;
      }
      setSelectedRoom({ id: data.id, name: data.name ?? name, mapName: data.mapName ?? 'KESTREL YARD' });
      goToLoadout();
    } catch {
      setError('SERVEUR INJOIGNABLE');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-[rgba(4,6,8,0.88)] font-hud">
      <div className="mx-auto flex max-w-[980px] flex-col gap-4 px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-[20px] font-semibold uppercase tracking-[0.22em] text-text-hi">
            /// COMMUNAUTÉ — SALONS &amp; MAPS
          </h1>
          <div className="flex gap-3">
            <TacticalButton variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void refresh()}>
              ACTUALISER
            </TacticalButton>
            <TacticalButton onClick={backToMenu}>RETOUR</TacticalButton>
          </div>
        </div>
        {error && <p className="text-[12px] uppercase tracking-[0.14em] text-danger">{error}</p>}

        {/* ===== SALONS ===== */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Panel>
            <div className="p-4">
              <p className="text-[14px] font-semibold uppercase tracking-[0.18em] text-amber">SALONS</p>
              <div className="mt-3 flex flex-col gap-2">
                {rooms.map((r) => (
                  <div
                    key={r.id}
                    className="chamfer-6 flex items-center justify-between border border-line bg-[rgba(13,19,26,0.6)] px-3 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-text-hi">
                        {r.name}
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.1em] text-text-mid">
                        MAP : {r.mapName} · {r.humans} joueur(s) · {r.bots} bot(s)
                      </span>
                    </div>
                    <TacticalButton variant="primary" onClick={() => joinRoom(r)}>
                      REJOINDRE
                    </TacticalButton>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="NOM DU SALON"
                  maxLength={24}
                  className="chamfer-6 flex-1 border border-line bg-[rgba(6,9,12,0.7)] px-2 py-1.5 text-[12px] uppercase tracking-[0.1em] text-text-hi outline-none placeholder:text-text-dim focus:border-line-strong"
                />
                <TacticalButton onClick={() => void createRoom(null, newRoomName || 'Salon perso')}>
                  {busy ? '…' : 'CRÉER (MAP DE BASE)'}
                </TacticalButton>
              </div>
            </div>
          </Panel>
        </motion.div>

        {/* ===== MAPS DE LA COMMUNAUTÉ ===== */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
          <Panel>
            <div className="p-4">
              <p className="text-[14px] font-semibold uppercase tracking-[0.18em] text-amber">
                MAPS DE LA COMMUNAUTÉ
              </p>
              {maps.length === 0 && (
                <p className="mt-2 text-[12px] uppercase tracking-[0.1em] text-text-mid">
                  AUCUNE MAP PUBLIÉE — CRÉEZ LA VÔTRE DANS L'ÉDITEUR (BOUTON « PUBLIER MA MAP »)
                </p>
              )}
              <div className="mt-3 flex flex-col gap-2">
                {maps.map((m) => (
                  <div
                    key={m.slug}
                    className="chamfer-6 flex items-center justify-between border border-line bg-[rgba(13,19,26,0.6)] px-3 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-text-hi">
                        {m.name}
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.1em] text-text-mid">
                        PAR {m.author} · {m.objectCount} objet(s) · {m.baseEditCount} édition(s) de base
                      </span>
                    </div>
                    <TacticalButton
                      variant="primary"
                      onClick={() => void createRoom(m.slug, m.name)}
                    >
                      {busy ? '…' : 'JOUER (NOUVEAU SALON)'}
                    </TacticalButton>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </motion.div>
      </div>
    </div>
  );
}
