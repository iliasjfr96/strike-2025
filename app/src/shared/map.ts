// ============================================================================
// STRIKE 2025 — map.ts « KESTREL YARD » (triport ferroviaire industriel)
// Fichier de DONNÉES : géométrie de collision (AABB), spawns, métadonnées.
// TypeScript pur, zéro dépendance externe (importe les types de ./sim).
//
// Recréé d'après le concept « KESTREL YARD » (image fournie par l'utilisateur) :
//  - OUEST (x < -12) : grand hangar bleu (intérieur jouable) + cour ouest
//  - CENTRE          : 3 voies ferrées nord-sud + tour de contrôle + passerelles
//  - EST   (x > +14) : bâtiment usine (intérieur) + quai du canal
//  - Spawns : NORD (z ≈ -46) et SUD (z ≈ +46, près du poste de garde).
// Repère : X -32 (ouest) → +35 (est/canal) ; Z -48 (nord) → +48 (sud) ; Y hauteur.
// ============================================================================

import type { AABB } from './sim';
import { aabb } from './sim';
import type { TeamId } from './protocol';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type BoxKind = 'container' | 'wall' | 'prop' | 'ground';

/** Clé de texture PBR (public/textures/kestrel) utilisée par le rendu. */
export type TexKey =
  | 'container' // container_side (teinté par color)
  | 'corrugated' // worn_corrugated_iron (tôle ondulée hangar)
  | 'blue-metal' // blue_metal_plate (bâtiments bleus)
  | 'factory' // factory_wall (bâtiment est)
  | 'concrete' // concrete (tour, barrières, canal)
  | 'grate' // metal_grate_rusty (passerelles)
  | 'asphalt' // asphalt_floor (sol cour)
  | 'concrete-floor' // concrete_floor (sol intérieurs)
  | 'gravel' // gravel_floor_02 (ballast)
  | 'wood' // brown_planks_03 (caisses/palettes)
  | 'shutter' // painted_metal_shutter (portes)
  | 'rust' // rusty_metal (divers métal)
  | 'none'; // rendu couleur simple

/** AABB de map : collision + informations de rendu. */
export interface MapBox extends AABB {
  kind: BoxKind;
  /** Couleur hex (teinte la texture / couleur simple si tex='none'). */
  color?: string;
  /** Texture PBR à appliquer (défaut selon kind). */
  tex?: TexKey;
  /** Échelle UV monde (m par période de texture, défaut 4). */
  uvScale?: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  /** Yaw de regard (convention sim.ts : 0 = vers -Z/nord, PI = vers +Z/sud). */
  yaw: number;
}

export interface LampPost {
  x: number;
  z: number;
  height: number;
}

// ----------------------------------------------------------------------------
// Constructeurs internes
// ----------------------------------------------------------------------------

const boxes: MapBox[] = [];

function box(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  kind: BoxKind, color?: string, tex?: TexKey, uvScale?: number,
): void {
  boxes.push({ ...aabb(minX, minY, minZ, maxX, maxY, maxZ), kind, color, tex, uvScale });
}

/** Boîte centrée (cx, cz), posée sur baseY, dimensions (sx, sy, sz). */
function cbox(
  cx: number, baseY: number, cz: number,
  sx: number, sy: number, sz: number,
  kind: BoxKind, color?: string, tex?: TexKey, uvScale?: number,
): void {
  box(cx - sx / 2, baseY, cz - sz / 2, cx + sx / 2, baseY + sy, cz + sz / 2, kind, color, tex, uvScale);
}

/** Conteneur 6.1 x 2.6 x 2.44 m. along='x' : longueur sur X. */
function container(cx: number, baseY: number, cz: number, along: 'x' | 'z', color: string): void {
  if (along === 'x') cbox(cx, baseY, cz, 6.1, 2.6, 2.44, 'container', color, 'container');
  else cbox(cx, baseY, cz, 2.44, 2.6, 6.1, 'container', color, 'container');
}

/** Caisse bois (0.9 m : franchissable au saut, cf. apex ~1.15 m). */
function crate(cx: number, cz: number, size = 1.4, h = 0.9): void {
  cbox(cx, 0, cz, size, h, size, 'prop', undefined, 'wood', 1.4);
}

/** Barrière jersey béton (couverture basse 1.1 m). */
function barrier(cx: number, cz: number, along: 'x' | 'z', len = 3): void {
  if (along === 'x') cbox(cx, 0, cz, len, 1.1, 0.45, 'prop', undefined, 'concrete', 2);
  else cbox(cx, 0, cz, 0.45, 1.1, len, 'prop', undefined, 'concrete', 2);
}

/** Escalier droit (marches AABB). dir = direction de MONTÉE. */
function stairs(
  x0: number, z0: number, dir: '+x' | '-x' | '+z' | '-z',
  steps: number, rise: number, run: number, width: number, tex: TexKey = 'grate',
): void {
  for (let i = 0; i < steps; i++) {
    const h = rise * (i + 1);
    if (dir === '+x') box(x0 + i * run, 0, z0, x0 + (i + 1) * run, h, z0 + width, 'prop', undefined, tex, 1);
    else if (dir === '-x') box(x0 - (i + 1) * run, 0, z0, x0 - i * run, h, z0 + width, 'prop', undefined, tex, 1);
    else if (dir === '+z') box(x0, 0, z0 + i * run, x0 + width, h, z0 + (i + 1) * run, 'prop', undefined, tex, 1);
    else box(x0, 0, z0 - (i + 1) * run, x0 + width, h, z0 - i * run, 'prop', undefined, tex, 1);
  }
}

// Palette conteneurs
const C_RUST = '#9c4a2f';
const C_BLUE = '#2f5d8c';
const C_GREEN = '#3f7a4e';
const C_TEAL = '#2e6f6a';
const C_ORANGE = '#b35c26';
const C_GREY = '#6d7276';

// ----------------------------------------------------------------------------
// 1. Enceinte (murs béton 4 m + canal à l'est)
// ----------------------------------------------------------------------------
box(-32.6, 0, -48.6, -32.0, 4, 48.6, 'wall', '#9aa4ac', 'concrete', 4); // ouest
box(-32.6, 0, -48.6, 35.0, 4, -48.0, 'wall', '#9aa4ac', 'concrete', 4); // nord
box(-32.6, 0, 48.0, 35.0, 4, 48.6, 'wall', '#9aa4ac', 'concrete', 4); // sud
// L'est est fermé par le mur de soutènement du canal (section 7).

// ----------------------------------------------------------------------------
// 2. Zone spawn NORD (z -48 .. -38) : deux petits bâtiments bleus + couvertures
// ----------------------------------------------------------------------------
cbox(-9, 0, -42.5, 8, 4.5, 5, 'wall', undefined, 'blue-metal', 3);
cbox(+4, 0, -43, 6, 4, 5, 'wall', undefined, 'blue-metal', 3);
crate(-16, -40);
crate(+12, -39.5);
barrier(-6, -37, 'x', 3);

// ----------------------------------------------------------------------------
// 3. HANGAR OUEST (x -30 .. -12, z -32 .. +14, hauteur 7 m) — intérieur jouable
// ----------------------------------------------------------------------------
// Face nord (z = -32) : portes de 4 m en x [-24,-20] et x [-16,-12].
box(-30.3, 0, -32.3, -24, 7, -31.7, 'wall', undefined, 'blue-metal', 2);
box(-20, 0, -32.3, -16, 7, -31.7, 'wall', undefined, 'blue-metal', 2);
box(-24, 4.6, -32.3, -20, 7, -31.7, 'wall', undefined, 'blue-metal', 2); // linteaux
box(-16, 4.6, -32.3, -12, 7, -31.7, 'wall', undefined, 'blue-metal', 2);
// Face ouest (pleine).
box(-30.3, 0, -32.3, -29.7, 7, 14.3, 'wall', undefined, 'blue-metal', 2);
// Face sud (z = +14) : porte de 4 m en x [-18,-14].
box(-30.3, 0, 13.7, -18, 7, 14.3, 'wall', undefined, 'blue-metal', 2);
box(-14, 0, 13.7, -11.7, 7, 14.3, 'wall', undefined, 'blue-metal', 2);
box(-18, 4.6, 13.7, -14, 7, 14.3, 'wall', undefined, 'blue-metal', 2);
// Face est (x = -12) : 3 docks de 3.4 m en z [-25,-21.6], [-7.2,-3.8], [+8.6,+12]
// + 2 passages de passerelle (z [-6.9,-6.1] et z [-1.9,-1.1], linteaux y 5.12).
box(-12.3, 0, -32.3, -11.7, 7, -25, 'wall', undefined, 'blue-metal', 2);
box(-12.3, 0, -21.6, -11.7, 7, -7.2, 'wall', undefined, 'blue-metal', 2);
box(-12.3, 0, -7.2, -11.7, 7, -6.9, 'wall', undefined, 'blue-metal', 2);
box(-12.3, 0, -6.1, -11.7, 7, -3.8, 'wall', undefined, 'blue-metal', 2);
box(-12.3, 0, -3.8, -11.7, 7, -1.9, 'wall', undefined, 'blue-metal', 2);
box(-12.3, 0, -1.1, -11.7, 7, 8.6, 'wall', undefined, 'blue-metal', 2);
box(-12.3, 0, 12, -11.7, 7, 14.3, 'wall', undefined, 'blue-metal', 2);
box(-12.3, 4.4, -25, -11.7, 7, -21.6, 'wall', undefined, 'blue-metal', 2); // linteaux docks
box(-12.3, 4.4, -7.2, -11.7, 7, -6.9, 'wall', undefined, 'blue-metal', 2); // dock 2 : le linteau
box(-12.3, 4.4, -6.1, -11.7, 7, -3.8, 'wall', undefined, 'blue-metal', 2); // s'interrompt pour la passerelle
box(-12.3, 4.4, 8.6, -11.7, 7, 12, 'wall', undefined, 'blue-metal', 2);
// Toit (collider) + piliers intérieurs.
box(-30.3, 7, -32.3, -11.7, 7.45, 14.3, 'prop', '#2a2f34', 'rust', 4);
for (const pz of [-22, -4, +10]) {
  cbox(-21, 0, pz, 0.55, 7, 0.55, 'prop', undefined, 'rust', 1);
}
// Contenu intérieur : conteneurs + caisses.
container(-26, 0, -18, 'z', C_TEAL);
container(-26, 2.6, -18, 'z', C_GREY);
crate(-17, -12);
crate(-25, 2);
crate(-17, 6.5);
barrier(-16.5, -27, 'x', 4);

// ----------------------------------------------------------------------------
// 4. COUR OUEST (x -30 .. -12, z +14 .. +38) : conteneurs orange + barrières
// ----------------------------------------------------------------------------
container(-25, 0, 19.5, 'z', C_ORANGE);
container(-19, 0, 24, 'x', C_ORANGE);
container(-26.5, 0, 28.5, 'z', C_RUST);
container(-19, 0, 32, 'x', C_ORANGE);
container(-19, 2.6, 32, 'x', C_GREY);
crate(-14.5, 19);
crate(-29.5, 20);
barrier(-13.5, 27.5, 'z', 4);
barrier(-22, 36, 'x', 5);

// ----------------------------------------------------------------------------
// 5. CENTRE : voies ferrées (visuel), wagon, barrières zigzag, tour, passerelles
// ----------------------------------------------------------------------------
// Wagon plat + conteneurs (voie x = 0, z +18 .. +30) — couverture centrale sud.
cbox(0, 0.55, 24, 3.2, 0.65, 13, 'prop', '#3a3230', 'rust', 3); // deck du wagon
container(0, 1.2, 21.5, 'z', C_RUST);
container(0, 1.2, 27, 'z', C_GREEN);
// Barrières zigzag béton le long des voies (couvertures croisées).
barrier(-7.5, -14, 'x', 4);
barrier(-5, -10.5, 'z', 3);
barrier(-7.5, -7, 'x', 4);
barrier(-5, -3.5, 'z', 3);
barrier(-7.5, 0, 'x', 4);
barrier(+5, 4, 'x', 4);
barrier(+7.5, 7.5, 'z', 3);
barrier(+5, 11, 'x', 4);
barrier(+7.5, 14.5, 'z', 3);
barrier(+5, 18, 'x', 4);

// TOUR DE CONTRÔLE (x 0, z -4) : base octogonale approchée par 2 AABB + bandeau.
cbox(0, 0, -4, 5, 8.6, 5, 'wall', undefined, 'concrete', 3);
box(-3.2, 0, -5.5, 3.2, 8.6, -2.5, 'wall', undefined, 'concrete', 3); // élargit (illusion octo)
cbox(0, 8.6, -4, 6, 2.2, 6, 'wall', undefined, 'concrete', 3); // cabine vitrée (collider)

// PASSERELLES (y = 5) : deux ponts parallèles est-ouest au-dessus des voies,
// interrompus par la tour et reconnectés par des plateformes de contournement.
// Accès : escalier intérieur du hangar (ouest, passe le mur via un slot à
// y 5.12 — hauteur libre 1.88 m) et escalier EXTÉRIEUR est dans la cour des
// voies (le bâtiment est, haut de 6 m, ne peut être traversé à cette hauteur).
// Pont nord : hangar -> face ouest du bâtiment est (x 13.7), sans y entrer.
box(-13, 4.9, -6.9, -2.9, 5.12, -6.1, 'prop', undefined, 'grate', 1);
box(2.9, 4.9, -6.9, 13.7, 5.12, -6.1, 'prop', undefined, 'grate', 1);
box(-3.5, 4.9, -7.9, 3.5, 5.12, -6.55, 'prop', undefined, 'grate', 1);
// Pont sud : hangar -> x 13.0, où l'escalier est le rejoint (jonction propre,
// sans intersection — descente non ambiguë).
box(-13, 4.9, -1.9, -2.9, 5.12, -1.1, 'prop', undefined, 'grate', 1);
box(2.9, 4.9, -1.9, 13.0, 5.12, -1.1, 'prop', undefined, 'grate', 1);
box(-3.5, 4.9, -1.25, 3.5, 5.12, 0.9, 'prop', undefined, 'grate', 1);
// Escaliers ouest INTÉRIEURS hangar (montent vers l'est) : un par pont —
// le pont sud aboutit aussi dans le hangar (sinon chute de 5 m).
stairs(-22.6, -6.75, '+x', 17, 5 / 17, 0.55, 1.1);
stairs(-22.6, -1.75, '+x', 17, 5 / 17, 0.55, 1.1);
// Escalier est EXTÉRIEUR : au sud de la tour, monte vers le nord depuis la
// cour (z +8.35 -> -1.0) et aboutit au pont sud — JAMAIS sous le pont
// (hauteur libre de descente garantie).
stairs(12.45, 8.35, '-z', 17, 5 / 17, 0.55, 1.1);

// Caisses éparses centre.
crate(-3, -18);
crate(+4, -24);
crate(-9, 10);
crate(+3, 26);

// ----------------------------------------------------------------------------
// 6. BÂTIMENT EST (x +14 .. +28, z -18 .. +6, hauteur 6 m) — intérieur jouable
// ----------------------------------------------------------------------------
// Face ouest (x = +14) : porte de 3 m en z [-5,-2]. Les passerelles S'ARRÊTENT
// à cette face (hauteur libre insuffisante pour les traverser).
box(13.7, 0, -18.3, 14.3, 6, -5, 'wall', undefined, 'factory', 3);
box(13.7, 0, -2, 14.3, 6, 6.3, 'wall', undefined, 'factory', 3);
box(13.7, 3.4, -5, 14.3, 6, -2, 'wall', undefined, 'factory', 3);
// Face nord (z = -18) : porte de 3.4 m en x [+18,+21.4].
box(13.7, 0, -18.3, 18, 6, -17.7, 'wall', undefined, 'factory', 3);
box(21.4, 0, -18.3, 28.3, 6, -17.7, 'wall', undefined, 'factory', 3);
box(18, 3.4, -18.3, 21.4, 6, -17.7, 'wall', undefined, 'factory', 3);
// Face sud (z = +6) : porte de 3.4 m en x [+18,+21.4].
box(13.7, 0, 5.7, 18, 6, 6.3, 'wall', undefined, 'factory', 3);
box(21.4, 0, 5.7, 28.3, 6, 6.3, 'wall', undefined, 'factory', 3);
box(18, 3.4, 5.7, 21.4, 6, 6.3, 'wall', undefined, 'factory', 3);
// Face est (x = +28) : 3 arches de 2.6 m vers le quai du canal
// en z [-13,-10.4], [-4.3,-1.7], [+2.4,+5] — linteaux au-dessus.
box(27.7, 0, -18.3, 28.3, 6, -13, 'wall', undefined, 'factory', 3);
box(27.7, 0, -10.4, 28.3, 6, -4.3, 'wall', undefined, 'factory', 3);
box(27.7, 0, -1.7, 28.3, 6, 2.4, 'wall', undefined, 'factory', 3);
box(27.7, 3.0, -13, 28.3, 6, -10.4, 'wall', undefined, 'factory', 3);
box(27.7, 3.0, -4.3, 28.3, 6, -1.7, 'wall', undefined, 'factory', 3);
box(27.7, 3.0, 2.4, 28.3, 6, 5, 'wall', undefined, 'factory', 3);
// Toit (collider).
box(13.7, 6, -18.3, 28.3, 6.4, 6.3, 'prop', '#2a2f34', 'rust', 4);
// Contenu intérieur : conteneur + caisses + pilier.
container(20, 0, -13.5, 'x', C_BLUE);
crate(18, 0);
crate(24.5, 2.5);
cbox(21, 0, -6, 0.5, 6, 0.5, 'prop', undefined, 'concrete', 1);

// ----------------------------------------------------------------------------
// 7. CANAL EST (x +28 .. +35) : quai jouable x +28..+30, eau en contrebas
// ----------------------------------------------------------------------------
// Quai jouable (niveau 0) entre le bâtiment et la garde : libre x 28.3..30.
// Garde-corps du quai (empêche de tomber dans l'eau) : hauteur 1.1 m.
box(30.0, 0, -30.6, 30.35, 1.1, 30.6, 'prop', undefined, 'rust', 1);
// Mur de soutènement est (de y -2.5 à 4) = frontière de map. Il court sur
// TOUTE la longueur : au-delà du canal (|z| > 30.6) il ferme les coins NE/SE
// (sinon on sort de la map en marchant — bug « hors de la map »).
box(34.4, -2.5, -48.6, 35.0, 4, 48.6, 'wall', '#9aa4ac', 'concrete', 3);
// Fonds du canal nord/sud (murs pleins sous l'eau — hors zone de jeu).
box(28.3, -2.5, -31.0, 35.0, 4, -30.4, 'wall', '#9aa4ac', 'concrete', 3);
box(28.3, -2.5, 30.4, 35.0, 4, 31.0, 'wall', '#9aa4ac', 'concrete', 3);

// ----------------------------------------------------------------------------
// 8. NORD-CENTRE : conteneurs teal (x +8 .. +14, z -34 .. -22)
// ----------------------------------------------------------------------------
container(9.5, 0, -31, 'z', C_TEAL);
container(12.5, 0, -26, 'x', C_TEAL);
container(9.5, 0, -22.5, 'z', C_TEAL);
container(9.5, 2.6, -31, 'z', C_GREY);
crate(13, -33);

// ----------------------------------------------------------------------------
// 9. SUD : poste de garde + portail + conteneurs orange (z +38 .. +48)
// ----------------------------------------------------------------------------
cbox(8, 0, 42, 5, 3.6, 4.4, 'wall', undefined, 'blue-metal', 3); // poste de garde
// Ligne de portail (z = +40) : segments + ouverture route x [+4,+12].
box(-32.6, 0, 39.7, 4, 3.2, 40.3, 'wall', undefined, 'concrete', 3);
box(12, 0, 39.7, 35.0, 3.2, 40.3, 'wall', undefined, 'concrete', 3);
// Conteneurs sud (couverture d'approche).
container(-8, 0, 37.5, 'x', C_ORANGE);
container(-15.5, 0, 37.5, 'x', C_RUST);
container(-15.5, 2.6, 37.5, 'x', C_GREY);
crate(-2, 35.5);
crate(+14, 36);
barrier(+20, 33, 'x', 4);

// ----------------------------------------------------------------------------
// 10. Lampadaires
// ----------------------------------------------------------------------------
export const LAMP_POSTS: LampPost[] = [
  { x: -10, z: -35, height: 5 },
  { x: -33, z: -10, height: 5.5 }, // côté hangar ouest
  { x: -16, z: 22, height: 5 },
  { x: -10, z: 34, height: 5 },
  { x: 8, z: -36, height: 5 },
  { x: 12, z: -10, height: 5 },
  { x: 26, z: 10, height: 5 },
  { x: 24, z: 30, height: 5 },
  { x: -4, z: 43.5, height: 5.5 },
  { x: -21, z: -6, height: 4 }, // intérieur hangar
  { x: -21, z: 6, height: 4 }, // intérieur hangar
  { x: 21, z: -6, height: 4.5 }, // intérieur bâtiment est
];
for (const l of LAMP_POSTS) {
  cbox(l.x, 0, l.z, 0.2, l.height, 0.2, 'prop', '#3a3f44', 'rust', 1);
}

// ----------------------------------------------------------------------------
// Exports principaux
// ----------------------------------------------------------------------------

export const MAP_BOXES: readonly MapBox[] = boxes;
export const MAP_COLLIDERS: readonly AABB[] = boxes;

/** 6 spawns par équipe : NORD (team 0, regarde le sud = yaw PI) / SUD (team 1). */
export const SPAWNS: Record<TeamId, SpawnPoint[]> = {
  0: [
    { x: -18, y: 0, z: -46, yaw: Math.PI },
    { x: -12, y: 0, z: -46.5, yaw: Math.PI },
    { x: -4, y: 0, z: -46, yaw: Math.PI },
    { x: 2, y: 0, z: -46.5, yaw: Math.PI },
    { x: 10, y: 0, z: -46, yaw: Math.PI },
    { x: 18, y: 0, z: -46, yaw: Math.PI },
  ],
  1: [
    { x: -12, y: 0, z: 46, yaw: 0 },
    { x: -6, y: 0, z: 46.5, yaw: 0 },
    { x: 0, y: 0, z: 46, yaw: 0 },
    { x: 6, y: 0, z: 46.5, yaw: 0 },
    { x: 14, y: 0, z: 46, yaw: 0 },
    { x: 20, y: 0, z: 46, yaw: 0 },
  ],
};

export const MAP_NAME = 'KESTREL YARD';
export const MAP_VERSION = 3;
export const MAP_BOUNDS = { minX: -32, maxX: 35, minZ: -48, maxZ: 48 };

/** Drapeaux décoratifs de zone de spawn. */
export const TEAM_FLAGS: Record<TeamId, { x: number; z: number }> = {
  0: { x: -2, z: -44.5 },
  1: { x: 2, z: 44.5 },
};

/** Métadonnées de la voie ferrée (rendu : ballast + traverses + rails). */
export const RAIL_LINES: number[] = [-6, 0, 6];

/** Métadonnées tour / canal / hangar pour le rendu custom. */
export const TOWER = { x: 0, z: -4, baseH: 8.6, cabH: 2.2 };
export const CANAL = { quayX0: 28.3, quayX1: 30.0, waterX0: 30.35, waterX1: 34.4, z0: -30.4, z1: 30.4, waterY: -1.3 };
export const HANGAR = { x0: -30.3, x1: -11.7, z0: -32.3, z1: 14.3, h: 7 };
export const EAST_BUILDING = { x0: 13.7, x1: 28.3, z0: -18.3, z1: 6.3, h: 6 };
export const CATWALK_Y = 5.12;

export function mapMeta(): { name: string; version: number; bounds: typeof MAP_BOUNDS } {
  return { name: MAP_NAME, version: MAP_VERSION, bounds: MAP_BOUNDS };
}

// ----------------------------------------------------------------------------
// Waypoints de patrouille des bots (3 couloirs, nord <-> sud)
// ----------------------------------------------------------------------------
export const WAYPOINT_LEFT: [number, number][] = [
  // OUEST : à travers le hangar puis la cour.
  [-21, -44], [-21, -38], [-22, -33.5], [-22, -29], [-19.8, -20], [-19.8, -12],
  [-24, -8], [-24, -2], [-19, 3], [-18, 10], [-16, 15.5], [-22, 20],
  [-23.5, 23.8], [-29, 25], [-29, 33], [-24, 35], [-18, 35], [-11.75, 35],
  [-11.75, 39.4], [4.8, 39.3], [4.8, 40.5], [4.8, 44], [-6, 44],
];

export const WAYPOINT_CENTER: [number, number][] = [
  // CENTRE : le long des voies (contourne la tour par l'est, évite le wagon).
  [0, -44], [0, -38], [-2, -32], [0, -26], [0, -20], [-2, -14], [0, -9],
  [4.2, -7], [4.2, -0.5], [4.2, 2.6], [-3, 8], [-6, 14], [-6, 20], [-6, 26],
  [-3, 32], [0, 38], [4.8, 39], [4.8, 40.5], [4.8, 44], [0, 44],
];

export const WAYPOINT_RIGHT: [number, number][] = [
  // EST : à travers le bâtiment (porte nord, contourne conteneur + caisse).
  [16, -44], [19.7, -38], [19.7, -33], [19.7, -22], [19.7, -16], [16.2, -15],
  [16.2, -11], [16.2, -8], [15.8, 1.5], [19.7, 7], [19.7, 9], [20, 14],
  [18, 20], [14, 26], [10, 32], [7, 35.5], [4.8, 39.5], [4.8, 44], [4, 44],
];

export const WAYPOINTS: Record<'left' | 'center' | 'right', [number, number][]> = {
  left: WAYPOINT_LEFT,
  center: WAYPOINT_CENTER,
  right: WAYPOINT_RIGHT,
};

// ----------------------------------------------------------------------------
// Hypothèses / vérifications de praticabilité
// ----------------------------------------------------------------------------
// 1. Hangar : 5 ouvertures >= 3.4 m (2 nord, 1 sud, 3 docks est de 3.4 m,
//    linteaux >= 4.4 m > 1.8 m joueur). Intérieur libre hors piliers/conteneurs.
// 2. Passerelles : marches de 0.294 m < STEP_HEIGHT 0.45 ; decks y 5.12 reliés
//    aux escaliers (marche finale h=5.0, contiguë au deck). Largeur 0.8-1.1 m.
// 3. Canal : quai x 28.3..30 (1.7 m de marche) + garde-corps 1.1 m ; l'eau est
//    inaccessible (pas de noyade à gérer). Arches bâtiment : 2.6 m de large,
//    linteaux y 3.0 (> 1.8).
// 4. Couloirs : ouest via hangar (portes alignées), centre le long des voies
//    (barrières zigzag franchissables en contournement, 1.1 m de haut), est via
//    le bâtiment (3 portes). Croisements z ≈ -35, z ≈ 15-20, z ≈ 38-40.
// 5. Spawns : 6 par équipe à z ±46, derrière les bâtiments/portail ; serveur =
//    choix du plus sûr (architecture.md). Aucun spawn dans un mur (validé sim).
// 6. Saut : inchangé (caisses 0.9 m franchissables, conteneurs 2.6 m non).
