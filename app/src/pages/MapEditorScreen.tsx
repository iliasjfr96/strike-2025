// ============================================================================
// STRIKE 2025 — MapEditorScreen.tsx
// Overlay UI du mode BUILD (éditeur de map) : palette d'objets à gauche,
// rappel des contrôles, compteur/statut de sauvegarde, boutons SAUVEGARDER /
// TOUT EFFACER / QUITTER. Le rendu 3D et les interactions souris/clavier sont
// gérés par MapEditorController (gameClient.editor) ; cet écran n'est que la
// façade React (pointer-events uniquement sur les panneaux — le canvas
// reçoit les clics partout ailleurs pour le pointer lock).
// ============================================================================

import { useEffect, useReducer, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameUI } from '../ui/store';
import { MAP_OBJECT_DEFS, MAX_PLACED_OBJECTS } from '../shared/mapObjects';
import { gameClient } from '../game/instance';
import { Panel, TacticalButton } from '../ui/components';
import ArmoryPanel from './ArmoryPanel';
import PropsPanel from './PropsPanel';

export default function MapEditorScreen() {
  const engineSetPhase = useGameUI((s) => s.engineSetPhase);
  const pseudo = useGameUI((s) => s.pseudo);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [mapName, setMapName] = useState('');
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [armoryOpen, setArmoryOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);

  const editor = gameClient.editor;
  const st = editor.getUIState();

  const publish = async (): Promise<void> => {
    if (publishing) return;
    setPublishing(true);
    setPublishMsg(null);
    const result = await editor.publish(mapName || 'Ma map', pseudo || 'anonyme');
    setPublishing(false);
    setPublishMsg(
      result
        ? `PUBLIÉE : « ${result.name} » — jouable depuis COMMUNAUTÉ`
        : 'ÉCHEC — map vide ou bibliothèque pleine ?',
    );
  };

  // Le contrôleur notifie chaque changement d'état visible (kind, rot, save…).
  useEffect(() => {
    editor.onChange = () => forceRender();
    return () => {
      editor.onChange = null;
    };
  }, [editor]);

  const quit = (): void => {
    if (st.dirty && !window.confirm('Des modifications ne sont pas sauvegardées. Quitter quand même ?')) {
      return;
    }
    engineSetPhase('menu');
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-30 font-hud">
      {/* ---- Palette (gauche) ---- */}
      <motion.div
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25 }}
        className="pointer-events-auto absolute left-4 top-4 flex max-h-[calc(100vh-32px)] w-[240px] flex-col"
      >
        <Panel className="flex min-h-0 flex-col">
          <div className="flex min-h-0 flex-col p-3">
            <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-amber">
              /// MODE BUILD
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-text-mid">
              {st.count}/{MAX_PLACED_OBJECTS} objets · rotation {st.rot * 90}°
            </p>
            <p className="text-[11px] uppercase tracking-[0.1em] text-text-mid">
              {st.carrying === 'base'
                ? `dimensions ${st.scale[0]} × ${st.scale[1]} × ${st.scale[2]} m`
                : `échelle ×${st.scale[0]} / ×${st.scale[1]} / ×${st.scale[2]}`}
            </p>
            {st.baseEditCount > 0 && (
              <p className="text-[11px] uppercase tracking-[0.1em] text-text-mid">
                {st.baseEditCount} édition(s) de la map de base
              </p>
            )}
            {st.carrying && (
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-amber">
                {st.carrying === 'base' ? 'OBJET DE BASE SAISI' : 'OBJET SAISI'} — CLIC GAUCHE : POSER · CLIC DROIT : ANNULER
              </p>
            )}
            {/* Mode de jeu du pack */}
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-dim">MODE DE JEU</p>
              <div className="mt-1 flex gap-1">
                {(
                  [
                    ['tdm', 'MATCH À MORT'],
                    ['dom', 'DOMINATION'],
                    ['sad', 'R&D'],
                  ] as ['tdm' | 'dom' | 'sad', string][]
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      editor.setGameMode(m);
                      forceRender();
                    }}
                    className={[
                      'chamfer-6 flex-1 border px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors',
                      (editor.gameMode?.type ?? 'tdm') === m
                        ? 'border-line-strong bg-[rgba(245,158,31,0.14)] text-text-hi'
                        : 'border-line text-text-mid hover:border-line-strong hover:text-text-hi',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {editor.gameMode?.type === 'dom' && (
                <>
                  <button
                    type="button"
                    onClick={() => editor.setKind('zone:capture')}
                    className={[
                      'chamfer-6 mt-1 w-full border px-2 py-1.5 text-left text-[12px] uppercase tracking-[0.1em] transition-colors',
                      st.kind === 'zone:capture'
                        ? 'border-line-strong bg-[rgba(88,166,232,0.16)] text-text-hi'
                        : 'border-line text-[#58A6E8] hover:border-line-strong hover:text-text-hi',
                    ].join(' ')}
                  >
                    ◎ POINT DE CAPTURE (A, B, C…)
                  </button>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
                    {(
                      [
                        ['scoreTarget', 'Points cibles', 200],
                        ['captureTimeS', 'Capture (s)', 10],
                        ['pointsPerSecond', 'Pts/s/zone', 1],
                        ['matchDurationS', 'Durée (s)', 600],
                      ] as ['scoreTarget' | 'captureTimeS' | 'pointsPerSecond' | 'matchDurationS', string, number][]
                    ).map(([key, label, def]) => (
                      <label key={key} className="flex items-center justify-between gap-1 text-[10px] uppercase tracking-[0.06em] text-text-mid">
                        {label}
                        <input
                          type="number"
                          value={editor.gameMode?.[key] ?? def}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            editor.setModeSetting(key, Number.isFinite(v) ? v : undefined);
                            forceRender();
                          }}
                          className="chamfer-6 w-[56px] border border-line bg-[rgba(6,9,12,0.7)] px-1 py-0.5 text-right text-[11px] text-text-hi outline-none focus:border-line-strong"
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
              {editor.gameMode?.type === 'sad' && (
                <>
                  <button
                    type="button"
                    onClick={() => editor.setKind('zone:bombsite')}
                    className={[
                      'chamfer-6 mt-1 w-full border px-2 py-1.5 text-left text-[12px] uppercase tracking-[0.1em] transition-colors',
                      st.kind === 'zone:bombsite'
                        ? 'border-line-strong bg-[rgba(245,158,31,0.16)] text-text-hi'
                        : 'border-line text-amber hover:border-line-strong hover:text-text-hi',
                    ].join(' ')}
                  >
                    ◈ SITE DE BOMBE (A / B)
                  </button>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
                    {(
                      [
                        ['roundsToWin', 'Rounds gagnants', 4],
                        ['roundTimeS', 'Round (s)', 105],
                        ['plantTimeS', 'Pose (s)', 4],
                        ['defuseTimeS', 'Désam. (s)', 6],
                        ['bombTimeS', 'Bombe (s)', 40],
                      ] as ['roundsToWin' | 'roundTimeS' | 'plantTimeS' | 'defuseTimeS' | 'bombTimeS', string, number][]
                    ).map(([key, label, def]) => (
                      <label key={key} className="flex items-center justify-between gap-1 text-[10px] uppercase tracking-[0.06em] text-text-mid">
                        {label}
                        <input
                          type="number"
                          value={editor.gameMode?.[key] ?? def}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            editor.setModeSetting(key, Number.isFinite(v) ? v : undefined);
                            forceRender();
                          }}
                          className="chamfer-6 w-[56px] border border-line bg-[rgba(6,9,12,0.7)] px-1 py-0.5 text-right text-[11px] text-text-hi outline-none focus:border-line-strong"
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Taille de la map (%) + spawns plaçables par équipe */}
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-dim">
                TAILLE DE LA MAP
              </span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={50}
                  max={200}
                  step={10}
                  value={editor.mapScale}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      editor.setMapScale(v);
                      forceRender();
                    }
                  }}
                  className="chamfer-6 w-[64px] border border-line bg-[rgba(6,9,12,0.7)] px-1 py-0.5 text-right text-[12px] text-text-hi outline-none focus:border-line-strong"
                />
                <span className="text-[11px] text-text-dim">%</span>
              </span>
            </div>
            {/* Taille des équipes (bots compléteront) — tous modes. */}
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-dim">
                JOUEURS PAR ÉQUIPE
              </span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={8}
                  step={1}
                  value={editor.gameMode?.teamSize ?? 8}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      editor.setTeamSize(v);
                      forceRender();
                    }
                  }}
                  className="chamfer-6 w-[64px] border border-line bg-[rgba(6,9,12,0.7)] px-1 py-0.5 text-right text-[12px] text-text-hi outline-none focus:border-line-strong"
                />
                <span className="text-[11px] text-text-dim">v{editor.gameMode?.teamSize ?? 8}</span>
              </span>
            </div>
            <div className="mt-1 flex gap-1">
              {(
                [
                  ['zone:spawn0', 'SPAWN SPECTRE', '#58A6E8'],
                  ['zone:spawn1', 'SPAWN RAVAGE', '#E0563F'],
                ] as [string, string, string][]
              ).map(([kind, label, color]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => editor.setKind(kind)}
                  className={[
                    'chamfer-6 flex-1 border px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.04em] transition-colors',
                    st.kind === kind
                      ? 'border-line-strong bg-[rgba(245,158,31,0.14)] text-text-hi'
                      : 'border-line hover:border-line-strong hover:text-text-hi',
                  ].join(' ')}
                  style={st.kind === kind ? undefined : { color }}
                >
                  ⌂ {label}
                </button>
              ))}
            </div>

            {/* Terrain de départ du pack */}
            <div className="mt-2 flex gap-1">
              {(
                [
                  ['kestrel', 'MAP DE BASE'],
                  ['flat', 'TERRAIN VIDE'],
                ] as ['kestrel' | 'flat', string][]
              ).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => editor.setTerrain(t)}
                  className={[
                    'chamfer-6 flex-1 border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors',
                    editor.baseTerrain === t
                      ? 'border-line-strong bg-[rgba(245,158,31,0.14)] text-text-hi'
                      : 'border-line text-text-mid hover:border-line-strong hover:text-text-hi',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Liste défilante (la palette dépasse l'écran depuis les 22
                nouveaux props) — la molette est libre hors pointer lock. */}
            <div className="mt-3 flex min-h-0 flex-col gap-1 overflow-y-auto pr-1">
              {Object.entries(MAP_OBJECT_DEFS).map(([kind, def]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => editor.setKind(kind)}
                  className={[
                    'chamfer-6 flex items-center justify-between border px-2 py-1.5 text-left text-[12px] uppercase tracking-[0.1em] transition-colors duration-fast',
                    st.kind === kind
                      ? 'border-line-strong bg-[rgba(245,158,31,0.14)] text-text-hi'
                      : 'border-line bg-[rgba(13,19,26,0.6)] text-text-mid hover:border-line-strong hover:text-text-hi',
                  ].join(' ')}
                >
                  <span>{def.label}</span>
                  <span className="text-[10px] text-text-dim">
                    {def.size[0]}×{def.size[1]}×{def.size[2]}
                  </span>
                </button>
              ))}
              {/* Props custom du pack (objets importés) */}
              {editor.props.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => editor.setKind(`prop:${p.id}`)}
                  className={[
                    'chamfer-6 flex items-center justify-between border px-2 py-1.5 text-left text-[12px] uppercase tracking-[0.1em] transition-colors duration-fast',
                    st.kind === `prop:${p.id}`
                      ? 'border-line-strong bg-[rgba(88,166,232,0.16)] text-text-hi'
                      : 'border-line bg-[rgba(13,19,26,0.6)] text-[#58A6E8] hover:border-line-strong hover:text-text-hi',
                  ].join(' ')}
                >
                  <span>◈ {p.label}</span>
                  <span className="text-[10px] text-text-dim">
                    {p.sizeX}×{p.sizeY}×{p.sizeZ}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPropsOpen(true)}
                className="chamfer-6 border border-dashed border-line px-2 py-1.5 text-left text-[12px] uppercase tracking-[0.1em] text-text-mid transition-colors hover:border-line-strong hover:text-text-hi"
              >
                + MES OBJETS (IMPORTER…)
              </button>
            </div>
          </div>
        </Panel>
      </motion.div>

      {/* ---- Contrôles + actions (droite) ---- */}
      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25 }}
        className="pointer-events-auto absolute right-4 top-4 w-[260px]"
      >
        <Panel>
          <div className="p-3">
            <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-text-hi">
              CONTRÔLES
            </p>
            <div className="mt-2 flex flex-col gap-1 text-[11px] uppercase tracking-[0.08em] text-text-mid">
              <p>CLIC CANVAS — capturer la souris</p>
              <p>ZQSD / WASD — voler · MAJ — rapide</p>
              <p>ESPACE — monter · C — descendre</p>
              <p className="text-amber">CLIC DROIT (ou E) — SAISIR l'objet visé (contour bleu)</p>
              <p>CLIC GAUCHE — poser / placer</p>
              <p>CLIC DROIT pendant un port — annuler</p>
              <p>SUPPR — supprimer l'objet visé</p>
              <p className="text-amber">OBJETS DE LA MAP DE BASE INCLUS</p>
              <p>MOLETTE — échelle · +X / +T / +V — un seul axe</p>
              <p>B — échelle 1:1 · R — rotation 90°</p>
              <p>U ou CTRL+Z — annuler · ÉCHAP — libérer la souris</p>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <TacticalButton variant="primary" onClick={() => editor.save()}>
                {st.dirty ? 'SAUVEGARDER LE BROUILLON *' : 'SAUVEGARDER LE BROUILLON'}
              </TacticalButton>
              {/* Réservé à l'admin : applique le pack à la map jouée par défaut. */}
              {typeof localStorage !== 'undefined' && localStorage.getItem('strike-admin-token') && (
                <TacticalButton onClick={() => void editor.applyToMain()}>
                  {st.saving ? 'APPLICATION…' : 'APPLIQUER AU SALON PRINCIPAL (ADMIN)'}
                </TacticalButton>
              )}
              <TacticalButton
                onClick={() => {
                  setArmoryOpen((v) => !v);
                  if (armoryOpen) editor.closePreview();
                }}
              >
                {armoryOpen ? 'FERMER L’ARMURERIE' : 'ARMURERIE'}
              </TacticalButton>
              <TacticalButton onClick={() => editor.clearAll()}>TOUT RESTAURER</TacticalButton>
              <TacticalButton onClick={quit}>QUITTER L'ÉDITEUR</TacticalButton>
            </div>
            {st.lastSaveOk !== null && (
              <p
                className={[
                  'mt-2 text-[11px] uppercase tracking-[0.1em]',
                  st.lastSaveOk ? 'text-[#69c98a]' : 'text-danger',
                ].join(' ')}
              >
                {st.lastSaveOk
                  ? st.lastSaveMsg ?? 'SAUVEGARDÉ'
                  : st.lastSaveError ?? 'ÉCHEC DE SAUVEGARDE — SERVEUR INJOIGNABLE ?'}
              </p>
            )}

            {/* ---- Publication communauté ---- */}
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-hi">
                PUBLIER DANS LA COMMUNAUTÉ
              </p>
              <input
                type="text"
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
                placeholder="NOM DE LA MAP"
                maxLength={24}
                className="chamfer-6 mt-2 w-full border border-line bg-[rgba(6,9,12,0.7)] px-2 py-1.5 text-[12px] uppercase tracking-[0.1em] text-text-hi outline-none placeholder:text-text-dim focus:border-line-strong"
              />
              <div className="mt-2">
                <TacticalButton onClick={() => void publish()}>
                  {publishing ? 'PUBLICATION…' : 'PUBLIER MA MAP'}
                </TacticalButton>
              </div>
              {publishMsg && (
                <p className="mt-2 text-[11px] uppercase tracking-[0.1em] text-amber">{publishMsg}</p>
              )}
            </div>
          </div>
        </Panel>
      </motion.div>

      {/* ---- Armurerie (mods d'armes du pack) ---- */}
      {armoryOpen && <ArmoryPanel onClose={() => { setArmoryOpen(false); editor.closePreview(); }} />}
      {/* ---- Mes objets (props importés du pack) ---- */}
      {propsOpen && <PropsPanel onClose={() => setPropsOpen(false)} />}

      {/* ---- Hint central quand la souris n'est pas capturée ---- */}
      {!st.locked && (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <p className="chamfer-6 border border-line bg-[rgba(6,9,12,0.7)] px-4 py-2 text-[13px] uppercase tracking-[0.16em] text-text-hi">
            CLIQUEZ SUR LA SCÈNE POUR ÉDITER
          </p>
        </div>
      )}

      {/* ---- Réticule éditeur ---- */}
      {st.locked && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="block h-[3px] w-[3px] bg-amber" />
        </div>
      )}
    </div>
  );
}
