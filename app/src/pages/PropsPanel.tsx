// ============================================================================
// STRIKE 2025 — PropsPanel.tsx
// Gestionnaire « MES OBJETS » de l'éditeur : import de modèles 3D d'objets de
// map (props) avec textures, calibration rotation + hauteur réelle, APERÇU 3D
// live. Les dimensions de collision sont calculées automatiquement depuis le
// modèle calibré. Les props font partie du pack (sauvegarde + publication) et
// apparaissent dans la palette de placement.
// ============================================================================

import { useReducer, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CustomPropDef } from '../shared/protocol';
import { MAX_CUSTOM_PROPS } from '../shared/mapObjects';
import { buildPropTemplate } from '../game/render/PropModels';
import { gameClient } from '../game/instance';
import { Panel, TacticalButton } from '../ui/components';
import WeaponPreview from './WeaponPreview';

/** Brouillon d'un prop en cours d'édition (avant enregistrement). */
interface Draft {
  id?: string;
  label: string;
  file: string;
  map?: string;
  normalMap?: string;
  rotY: number;
  height: number;
}

export default function PropsPanel({ onClose }: { onClose: () => void }) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const texRef = useRef<HTMLInputElement>(null);
  const normalRef = useRef<HTMLInputElement>(null);

  const editor = gameClient.editor;
  const props = editor.props;

  const onModel = async (f: File | null): Promise<void> => {
    if (!f || busy) return;
    setBusy(true);
    setMsg(null);
    const result = await editor.uploadModel(await f.arrayBuffer());
    setBusy(false);
    if (!result.file) {
      setMsg(`ÉCHEC — ${result.error ?? 'erreur inconnue'}`);
      return;
    }
    setDraft({
      ...(draft ?? { label: '', rotY: 0, height: 1 }),
      file: result.file,
      label: draft?.label || f.name.replace(/\.[^.]+$/, '').slice(0, 20),
    });
    setMsg('MODÈLE CHARGÉ — réglez la hauteur puis ENREGISTRER');
  };

  const onTexture = async (f: File | null, kind: 'map' | 'normalMap'): Promise<void> => {
    if (!f || busy || !draft) return;
    setBusy(true);
    const result = await editor.uploadTexture(await f.arrayBuffer());
    setBusy(false);
    if (!result.file) {
      setMsg(`ÉCHEC — ${result.error ?? 'erreur inconnue'}`);
      return;
    }
    setDraft({ ...draft, [kind]: result.file });
  };

  /** Enregistre le brouillon : les dimensions de collision sont mesurées sur
   *  le modèle calibré (le serveur ne charge jamais de 3D). */
  const save = async (): Promise<void> => {
    if (!draft || busy) return;
    setBusy(true);
    setMsg(null);
    const tpl = await buildPropTemplate(draft);
    setBusy(false);
    if (!tpl) {
      setMsg('ÉCHEC — modèle illisible');
      return;
    }
    const def: Omit<CustomPropDef, 'id'> & { id?: string } = {
      id: draft.id,
      label: draft.label || 'OBJET',
      file: draft.file,
      map: draft.map,
      normalMap: draft.normalMap,
      rotY: draft.rotY,
      height: draft.height,
      sizeX: tpl.sizeX,
      sizeY: tpl.sizeY,
      sizeZ: tpl.sizeZ,
    };
    const id = editor.upsertProp(def);
    if (id === null) {
      setMsg(`ÉCHEC — limite de ${MAX_CUSTOM_PROPS} objets atteinte`);
      return;
    }
    setMsg(`ENREGISTRÉ — « ${def.label} » est dans la palette (${tpl.sizeX} × ${tpl.sizeY} × ${tpl.sizeZ} m)`);
    setDraft(null);
    forceRender();
  };

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-4 top-4 z-40 mx-auto w-[560px] max-w-[95vw] overflow-y-auto">
      <Panel>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-semibold uppercase tracking-[0.2em] text-amber">/// MES OBJETS</p>
            <button type="button" onClick={onClose} aria-label="Fermer">
              <X size={18} className="text-text-mid transition-colors hover:text-text-hi" />
            </button>
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-text-mid">
            Importez vos modèles 3D (GLB recommandé, GLTF/FBX/OBJ/STL acceptés) — ils rejoignent la
            palette de placement et voyagent avec le pack.
          </p>

          {/* Liste des props du pack */}
          <div className="mt-3 flex flex-col gap-1.5">
            {props.length === 0 && (
              <p className="text-[11px] uppercase tracking-[0.1em] text-text-dim">
                AUCUN OBJET IMPORTÉ POUR L'INSTANT
              </p>
            )}
            {props.map((p) => (
              <div
                key={p.id}
                className="chamfer-6 flex items-center justify-between border border-line bg-[rgba(13,19,26,0.6)] px-2 py-1.5"
              >
                <span className="text-[12px] uppercase tracking-[0.1em] text-text-hi">
                  {p.label}
                  <span className="ml-2 text-[10px] text-text-dim">
                    {p.sizeX} × {p.sizeY} × {p.sizeZ} m
                  </span>
                </span>
                <span className="flex gap-2">
                  <TacticalButton
                    onClick={() => {
                      setDraft({ id: p.id, label: p.label, file: p.file, map: p.map, normalMap: p.normalMap, rotY: p.rotY, height: p.height });
                      setMsg(null);
                    }}
                  >
                    MODIFIER
                  </TacticalButton>
                  <TacticalButton
                    onClick={() => {
                      editor.removeProp(p.id);
                      forceRender();
                    }}
                  >
                    SUPPRIMER
                  </TacticalButton>
                </span>
              </div>
            ))}
          </div>

          {/* Import / édition */}
          <div className="mt-4 border-t border-line pt-3">
            <input ref={modelRef} type="file" accept=".glb,.gltf,.fbx,.obj,.stl" className="hidden" onChange={(e) => void onModel(e.target.files?.[0] ?? null)} />
            <input ref={texRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/*" className="hidden" onChange={(e) => void onTexture(e.target.files?.[0] ?? null, 'map')} />
            <input ref={normalRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/*" className="hidden" onChange={(e) => void onTexture(e.target.files?.[0] ?? null, 'normalMap')} />
            <div className="flex flex-wrap items-center gap-2">
              <TacticalButton variant="primary" onClick={() => modelRef.current?.click()}>
                {busy ? '…' : draft ? 'REMPLACER LE MODÈLE' : '+ IMPORTER UN OBJET'}
              </TacticalButton>
              {draft && (
                <>
                  <TacticalButton onClick={() => texRef.current?.click()}>
                    {draft.map ? 'TEXTURE ✓' : '+ TEXTURE'}
                  </TacticalButton>
                  <TacticalButton onClick={() => normalRef.current?.click()}>
                    {draft.normalMap ? 'NORMALE ✓' : '+ NORMALE'}
                  </TacticalButton>
                  <TacticalButton onClick={() => void save()}>{busy ? '…' : 'ENREGISTRER'}</TacticalButton>
                  <TacticalButton onClick={() => setDraft(null)}>ANNULER</TacticalButton>
                </>
              )}
            </div>
            {msg && <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-amber">{msg}</p>}

            {draft && (
              <>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                  <label className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em] text-text-mid">
                    Nom
                    <input
                      type="text"
                      maxLength={20}
                      value={draft.label}
                      onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                      className="chamfer-6 w-[140px] border border-line bg-[rgba(6,9,12,0.7)] px-1.5 py-0.5 text-right text-[12px] uppercase text-text-hi outline-none focus:border-line-strong"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em] text-text-mid">
                    Hauteur (m)
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={draft.height}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) setDraft({ ...draft, height: Math.min(20, Math.max(0.1, v)) });
                      }}
                      className="chamfer-6 w-[84px] border border-line bg-[rgba(6,9,12,0.7)] px-1.5 py-0.5 text-right text-[12px] text-text-hi outline-none focus:border-line-strong"
                    />
                  </label>
                  <label className="col-span-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em] text-text-mid">
                    Orientation
                    <span className="flex gap-1">
                      {[0, 90, 180, 270].map((deg) => (
                        <button
                          key={deg}
                          type="button"
                          onClick={() => setDraft({ ...draft, rotY: (deg * Math.PI) / 180 })}
                          className={[
                            'chamfer-6 border px-1.5 py-0.5 text-[11px]',
                            Math.abs(((draft.rotY * 180) / Math.PI + 360) % 360 - deg) < 1
                              ? 'border-line-strong text-amber'
                              : 'border-line text-text-mid hover:text-text-hi',
                          ].join(' ')}
                        >
                          {deg}°
                        </button>
                      ))}
                    </span>
                  </label>
                </div>
                {/* Aperçu 3D live (mode prop : hauteur = échelle réelle). */}
                <WeaponPreview propDef={{ file: draft.file, rotY: draft.rotY, height: draft.height, map: draft.map, normalMap: draft.normalMap }} />
              </>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
