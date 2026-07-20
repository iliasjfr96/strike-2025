// ============================================================================
// STRIKE 2025 — ArmoryPanel.tsx
// Panneau ARMURERIE de l'éditeur : par arme, réglage des stats (bornées — le
// serveur revalide de toute façon) et modèle 3D custom (upload GLB +
// calibration rotation/longueur/visée/bouche avec APERÇU 3D live dans la
// scène de l'éditeur). Les mods font partie du « pack » sauvegardé/publié.
// ============================================================================

import { useReducer, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { ClassId, WeaponId, WeaponModelMod, WeaponStatsMod } from '../shared/protocol';
import { CLASS_LOADOUTS_ORIGINAL, STAT_LIMITS, WEAPONS_ORIGINAL } from '../shared/weaponMods';
import { defaultModelDef } from '../game/render/WeaponModels';
import { gameClient } from '../game/instance';
import { Panel, TacticalButton } from '../ui/components';
import WeaponPreview from './WeaponPreview';

const WEAPON_TABS: { id: WeaponId; label: string }[] = [
  { id: 'vsk27', label: 'VSK-27' },
  { id: 'kv9', label: 'KV-9' },
  { id: 'lr50', label: 'LR-50' },
  { id: 'p9', label: 'P9' },
  { id: 'm4', label: 'M4' },
  { id: 'mp5', label: 'MP5' },
  { id: 'spas12', label: 'M590' },
  { id: 'deagle', label: 'DEAGLE' },
  { id: 'custom1', label: 'CUSTOM 1' },
  { id: 'custom2', label: 'CUSTOM 2' },
  { id: 'custom3', label: 'CUSTOM 3' },
];

const ALL_WEAPON_IDS: WeaponId[] = ['vsk27', 'kv9', 'lr50', 'p9', 'm4', 'mp5', 'spas12', 'deagle', 'custom1', 'custom2', 'custom3'];
const CLASS_TABS: { id: ClassId; label: string }[] = [
  { id: 'assault', label: 'ASSAUT' },
  { id: 'cqc', label: 'CQC' },
  { id: 'recon', label: 'RECON' },
  { id: 'breacher', label: 'BREACHER' },
];

/** Champs de stats exposés (libellé FR + clé + pas). */
const STAT_FIELDS: { key: keyof typeof STAT_LIMITS; label: string; step: number }[] = [
  { key: 'damage', label: 'Dégâts / balle', step: 1 },
  { key: 'rpm', label: 'Cadence (RPM)', step: 5 },
  { key: 'magSize', label: 'Chargeur', step: 1 },
  { key: 'reserveAmmo', label: 'Réserve', step: 5 },
  { key: 'reloadMs', label: 'Rechargement (ms)', step: 50 },
  { key: 'adsMs', label: 'Visée (ms)', step: 10 },
  { key: 'adsFovMult', label: 'Zoom ADS (×FOV)', step: 0.05 },
  { key: 'recoilV', label: 'Recul vertical (°)', step: 0.05 },
  { key: 'recoilH', label: 'Recul horizontal (°)', step: 0.05 },
  { key: 'spreadHip', label: 'Dispersion hanche (°)', step: 0.1 },
  { key: 'spreadAds', label: 'Dispersion visée (°)', step: 0.05 },
  { key: 'mobility', label: 'Mobilité (×vitesse)', step: 0.01 },
  { key: 'drawMs', label: 'Sortie d’arme (ms)', step: 25 },
];

function defaultValue(id: WeaponId, key: keyof typeof STAT_LIMITS): number {
  const o = WEAPONS_ORIGINAL[id];
  switch (key) {
    case 'recoilV': return o.recoil.vertical;
    case 'recoilH': return o.recoil.horizontal;
    case 'spreadHip': return o.spread.hip;
    case 'spreadAds': return o.spread.ads;
    default: return o[key];
  }
}

export default function ArmoryPanel({ onClose }: { onClose: () => void }) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [tab, setTab] = useState<WeaponId>('vsk27');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const texRef = useRef<HTMLInputElement>(null);
  const normalRef = useRef<HTMLInputElement>(null);

  const editor = gameClient.editor;
  const mods = editor.weaponMods;
  const entry = mods[tab];
  const stats: WeaponStatsMod = entry?.stats ?? {};
  const model = entry?.model ?? null;

  const setStat = (key: keyof typeof STAT_LIMITS, raw: string): void => {
    const v = raw === '' ? undefined : Number(raw);
    if (v !== undefined && !Number.isFinite(v)) return;
    const [min, max] = STAT_LIMITS[key];
    editor.setWeaponStat(tab, key, v === undefined ? undefined : Math.min(max, Math.max(min, v)));
    forceRender();
  };

  // Calibration EFFECTIVE : valeurs du mod, complétées par le modèle d'origine
  // (l'arme de base est calibrable librement, même sans upload — file absent).
  const base = defaultModelDef(tab);
  const cal = {
    file: model?.file ?? base.file,
    rotY: model?.rotY ?? base.rotY,
    rotX: model?.rotX ?? base.rotX ?? 0,
    rotZ: model?.rotZ ?? base.rotZ ?? 0,
    realLength: model?.realLength ?? base.realLength,
    adsY: model?.adsY ?? base.adsY,
    muzzleY: model?.muzzleY ?? base.muzzleY,
    offX: model?.offX ?? 0,
    offY: model?.offY ?? 0,
    offZ: model?.offZ ?? 0,
    map: model?.map,
    normalMap: model?.normalMap,
  };

  /** Modifie la calibration — crée le mod à la volée (sans file : arme de base). */
  const setCal = (patch: Partial<WeaponModelMod>): void => {
    const next: WeaponModelMod = {
      file: model?.file,
      rotY: cal.rotY,
      rotX: model?.rotX,
      rotZ: model?.rotZ,
      realLength: cal.realLength,
      adsY: cal.adsY,
      muzzleY: cal.muzzleY,
      offX: model?.offX,
      offY: model?.offY,
      offZ: model?.offZ,
      map: model?.map,
      normalMap: model?.normalMap,
      ...patch,
    };
    editor.setWeaponModel(tab, next);
    forceRender();
  };

  const onFile = async (f: File | null): Promise<void> => {
    if (!f || uploading) return;
    setUploading(true);
    setUploadMsg(null);
    const buf = await f.arrayBuffer();
    const result = await editor.uploadModel(buf);
    setUploading(false);
    if (!result.file) {
      setUploadMsg(`ÉCHEC — ${result.error ?? 'erreur inconnue'}`);
      return;
    }
    editor.setWeaponModel(tab, { file: result.file, rotY: 0, realLength: 0.8, adsY: 0.08, muzzleY: 0.02 });
    setUploadMsg('MODÈLE CHARGÉ — calibrez avec l’aperçu ci-dessous');
    forceRender();
  };

  /** Upload d'une texture (couleur ou normale) rattachée au modèle courant. */
  const onTexture = async (f: File | null, kind: 'map' | 'normalMap'): Promise<void> => {
    if (!f || uploading || !model) return;
    setUploading(true);
    setUploadMsg(null);
    const result = await editor.uploadTexture(await f.arrayBuffer());
    setUploading(false);
    if (!result.file) {
      setUploadMsg(`ÉCHEC — ${result.error ?? 'erreur inconnue'}`);
      return;
    }
    editor.setWeaponModel(tab, { ...model, [kind]: result.file });
    setUploadMsg(kind === 'map' ? 'TEXTURE COULEUR APPLIQUÉE' : 'TEXTURE NORMALE APPLIQUÉE');
    forceRender();
  };

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-4 top-4 z-40 mx-auto w-[560px] max-w-[95vw] overflow-y-auto">
      <Panel>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-semibold uppercase tracking-[0.2em] text-amber">/// ARMURERIE</p>
            <button type="button" onClick={onClose} aria-label="Fermer">
              <X size={18} className="text-text-mid transition-colors hover:text-text-hi" />
            </button>
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-text-mid">
            Les réglages font partie du pack (sauvegarde + publication). Bornés côté serveur.
          </p>

          {/* Onglets armes */}
          <div className="mt-3 flex flex-wrap gap-2">
            {WEAPON_TABS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setTab(w.id)}
                className={[
                  'chamfer-6 border px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors',
                  tab === w.id
                    ? 'border-line-strong bg-[rgba(245,158,31,0.14)] text-text-hi'
                    : 'border-line text-text-mid hover:border-line-strong hover:text-text-hi',
                ].join(' ')}
              >
                {w.label}
                {mods[w.id] && <span className="ml-1 text-amber">*</span>}
              </button>
            ))}
          </div>

          {/* Nom affiché (HUD / killfeed) */}
          <label className="mt-3 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em] text-text-mid">
            Nom affiché
            <input
              type="text"
              maxLength={20}
              value={stats.name ?? WEAPONS_ORIGINAL[tab].name}
              onChange={(e) => {
                const v = e.target.value;
                editor.setWeaponStat(tab, 'name', v === WEAPONS_ORIGINAL[tab].name || v === '' ? undefined : v);
                forceRender();
              }}
              className="chamfer-6 w-[180px] border border-line bg-[rgba(6,9,12,0.7)] px-1.5 py-0.5 text-right text-[12px] uppercase text-text-hi outline-none focus:border-line-strong"
            />
          </label>

          {/* Stats */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            <label className="col-span-2 flex items-center gap-2 text-[12px] uppercase tracking-[0.1em] text-text-mid">
              <input
                type="checkbox"
                checked={stats.auto ?? WEAPONS_ORIGINAL[tab].auto}
                onChange={(e) => {
                  editor.setWeaponStat(
                    tab,
                    'auto',
                    e.target.checked === WEAPONS_ORIGINAL[tab].auto ? undefined : e.target.checked,
                  );
                  forceRender();
                }}
              />
              TIR AUTOMATIQUE
            </label>
            {STAT_FIELDS.map((f) => {
              const cur = (stats[f.key] as number | undefined) ?? defaultValue(tab, f.key);
              const modded = stats[f.key] !== undefined;
              const [min, max] = STAT_LIMITS[f.key];
              return (
                <label key={f.key} className="flex items-center justify-between gap-2">
                  <span
                    className={[
                      'text-[11px] uppercase tracking-[0.08em]',
                      modded ? 'text-amber' : 'text-text-mid',
                    ].join(' ')}
                  >
                    {f.label}
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      value={cur}
                      min={min}
                      max={max}
                      step={f.step}
                      onChange={(e) => setStat(f.key, e.target.value)}
                      className="chamfer-6 w-[84px] border border-line bg-[rgba(6,9,12,0.7)] px-1.5 py-0.5 text-right text-[12px] text-text-hi outline-none focus:border-line-strong"
                    />
                    {modded && (
                      <button
                        type="button"
                        title="Valeur d'origine"
                        onClick={() => {
                          editor.setWeaponStat(tab, f.key, undefined);
                          forceRender();
                        }}
                        className="text-[11px] text-text-dim hover:text-text-hi"
                      >
                        ↺
                      </button>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          {/* Modèle 3D custom */}
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-hi">
              MODÈLE 3D CUSTOM
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-text-dim">
              GLB recommandé (textures embarquées) · GLTF embarqué / FBX / OBJ / STL acceptés
              (OBJ/STL : matériau gris ; textures externes non chargées)
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".glb,.gltf,.fbx,.obj,.stl,model/gltf-binary"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              />
              <TacticalButton onClick={() => fileRef.current?.click()}>
                {uploading ? 'ENVOI…' : model ? 'REMPLACER LE MODÈLE' : 'UPLOADER UN MODÈLE'}
              </TacticalButton>
              {model && (
                <TacticalButton
                  onClick={() => {
                    editor.setWeaponModel(tab, null);
                    forceRender();
                  }}
                >
                  RETIRER
                </TacticalButton>
              )}
            </div>
            {uploadMsg && (
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-amber">{uploadMsg}</p>
            )}

            {/* Fenêtre d'aperçu 3D — modèle custom OU modèle d'origine,
                avec la calibration LIVE (rotations/offsets libres). */}
            <WeaponPreview def={{ ...cal }} />

            {model && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  ref={texRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/*"
                  className="hidden"
                  onChange={(e) => void onTexture(e.target.files?.[0] ?? null, 'map')}
                />
                <input
                  ref={normalRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/*"
                  className="hidden"
                  onChange={(e) => void onTexture(e.target.files?.[0] ?? null, 'normalMap')}
                />
                <TacticalButton onClick={() => texRef.current?.click()}>
                  {model.map ? 'TEXTURE ✓' : '+ TEXTURE COULEUR'}
                </TacticalButton>
                <TacticalButton onClick={() => normalRef.current?.click()}>
                  {model.normalMap ? 'NORMALE ✓' : '+ NORMALE'}
                </TacticalButton>
                {(model.map || model.normalMap) && (
                  <TacticalButton
                    onClick={() => {
                      editor.setWeaponModel(tab, { ...model, map: undefined, normalMap: undefined });
                      forceRender();
                    }}
                  >
                    RETIRER TEXTURES
                  </TacticalButton>
                )}
              </div>
            )}
            {/* Calibration LIBRE — arme de base OU modèle uploadé. */}
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-hi">
                CALIBRATION LIBRE {model && <span className="text-amber">*</span>}
              </p>
              {model && (
                <TacticalButton
                  onClick={() => {
                    // Modèle uploadé : garde le fichier, calibration remise à
                    // plat ; arme de base : retire tout le mod (origine).
                    if (model.file) {
                      editor.setWeaponModel(tab, {
                        file: model.file,
                        rotY: 0,
                        realLength: 0.8,
                        adsY: 0.08,
                        muzzleY: 0.02,
                        map: model.map,
                        normalMap: model.normalMap,
                      });
                    } else {
                      editor.setWeaponModel(tab, null);
                    }
                    forceRender();
                  }}
                >
                  ↺ RÉINITIALISER
                </TacticalButton>
              )}
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {(
                [
                  ['rotY', 'Rotation canon (Y)'],
                  ['rotX', 'Tangage (X)'],
                  ['rotZ', 'Roulis (Z)'],
                ] as ['rotY' | 'rotX' | 'rotZ', string][]
              ).map(([key, label]) => {
                const deg = Math.round((cal[key] * 180) / Math.PI);
                return (
                  <label key={key} className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-text-mid">
                    <span className="w-[128px] shrink-0">{label}</span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={deg}
                      onChange={(e) => setCal({ [key]: (Number(e.target.value) * Math.PI) / 180 })}
                      className="min-w-0 flex-1 accent-[#F59E1F]"
                    />
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      step={1}
                      value={deg}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) setCal({ [key]: (Math.min(180, Math.max(-180, v)) * Math.PI) / 180 });
                      }}
                      className="chamfer-6 w-[64px] border border-line bg-[rgba(6,9,12,0.7)] px-1 py-0.5 text-right text-[12px] text-text-hi outline-none focus:border-line-strong"
                    />
                    <span className="w-[8px] text-text-dim">°</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
              {(
                [
                  ['realLength', 'Longueur (m)', 0.05],
                  ['adsY', 'Hauteur visée (m)', 0.005],
                  ['muzzleY', 'Hauteur bouche (m)', 0.005],
                  ['offX', 'Position droite (m)', 0.01],
                  ['offY', 'Position haut (m)', 0.01],
                  ['offZ', 'Position avant (m)', 0.01],
                ] as ['realLength' | 'adsY' | 'muzzleY' | 'offX' | 'offY' | 'offZ', string, number][]
              ).map(([key, label, step]) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em] text-text-mid"
                >
                  {label}
                  <input
                    type="number"
                    value={cal[key]}
                    step={step}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setCal({ [key]: v });
                    }}
                    className="chamfer-6 w-[84px] border border-line bg-[rgba(6,9,12,0.7)] px-1.5 py-0.5 text-right text-[12px] text-text-hi outline-none focus:border-line-strong"
                  />
                </label>
              ))}
              <p className="col-span-2 text-[10px] uppercase tracking-[0.08em] text-text-dim">
                Aperçu : ligne bleue = ligne de visée · sphère ambre = bouche du canon (doit pointer
                vers l'avant). Réglages libres — appliqués en jeu à la sauvegarde du pack.
              </p>
            </div>
          </div>

          {/* Loadouts : assigner les armes (dont custom) aux classes */}
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-hi">
              LOADOUTS DES CLASSES
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-text-dim">
              Assignez vos armes custom aux classes — sans toucher aux armes d'origine.
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {CLASS_TABS.map((c) => {
                const pair = editor.loadouts[c.id] ?? CLASS_LOADOUTS_ORIGINAL[c.id];
                const modded = editor.loadouts[c.id] !== undefined;
                const setPair = (slot: 0 | 1, wid: WeaponId): void => {
                  const next: [WeaponId, WeaponId] = [pair[0], pair[1]];
                  next[slot] = wid;
                  const orig = CLASS_LOADOUTS_ORIGINAL[c.id];
                  editor.setClassLoadout(
                    c.id,
                    next[0] === orig[0] && next[1] === orig[1] ? null : next,
                  );
                  forceRender();
                };
                const weaponName = (id: WeaponId): string =>
                  mods[id]?.stats?.name ?? WEAPONS_ORIGINAL[id].name;
                const selectCls =
                  'chamfer-6 border border-line bg-[rgba(6,9,12,0.7)] px-1.5 py-0.5 text-[11px] uppercase text-text-hi outline-none focus:border-line-strong';
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <span
                      className={[
                        'text-[11px] uppercase tracking-[0.1em]',
                        modded ? 'text-amber' : 'text-text-mid',
                      ].join(' ')}
                    >
                      {c.label}
                    </span>
                    <span className="flex items-center gap-2">
                      <select
                        value={pair[0]}
                        onChange={(e) => setPair(0, e.target.value as WeaponId)}
                        className={selectCls}
                      >
                        {ALL_WEAPON_IDS.map((id) => (
                          <option key={id} value={id}>
                            {weaponName(id)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={pair[1]}
                        onChange={(e) => setPair(1, e.target.value as WeaponId)}
                        className={selectCls}
                      >
                        {ALL_WEAPON_IDS.map((id) => (
                          <option key={id} value={id}>
                            {weaponName(id)}
                          </option>
                        ))}
                      </select>
                      {modded && (
                        <button
                          type="button"
                          title="Loadout d'origine"
                          onClick={() => {
                            editor.setClassLoadout(c.id, null);
                            forceRender();
                          }}
                          className="text-[11px] text-text-dim hover:text-text-hi"
                        >
                          ↺
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
