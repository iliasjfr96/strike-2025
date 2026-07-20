# Plan — Refonte graphique STRIKE 2025 (v2 visuelle)

## Retour utilisateur
Jeu « moche » : tout en carrés, map trop petite, armes ridicules/buggées, lag.
Attente : rendu 3D type Call of Duty (réaliste, texturé, vivant).

## Vague de refonte (2 agents parallèles + intégration lead)

### Agent MONDE (branche `gfx-world`)
Scope : `src/game/render/MapBuilder.ts`, `src/game/render/Renderer.ts`,
`src/shared/map.ts` (AUTORISATION SPÉCIALE lead, contraintes strictes),
`public/sky-dusk.jpg` (généré).
- Skybox équirectangulaire générée (crépuscule portuaire 2K 2:1) + environment lighting
- Containers : textures procédurales CanvasTexture (tôle ondulée nervurée, rouille,
  numéros/logo peints), montants d'angle, portes ouvertes sur certains
- Sol : asphalte détaillé (marquages quai, taches, rails grue), eau animée côté dock
- Grue portique détaillée (poutres, trolley, câbles, cabine, bandes warning)
- Props : fûts (cylindres), palettes, caisses bois, bornes, coque de cargo en fond,
  silhouettes portuaires à l'horizon avec lumières
- Map agrandie ~110×56 m : + intérieur d'entrepôt (toit, ouvertures),
  + passerelle/catwalk accessible (escaliers), densité de cover
- CONTRAINTES map.ts : mêmes exports (MapBox, MAP_COLLIDERS, SPAWNS 12, WAYPOINTS,
  WAYPOINT_CENTER, mapMeta 'DRYDOCK') — valider routes en sim (script), E2E doit rester vert
- PERF : lampadaires en émissif + halos sprite (≤ 4 vraies PointLight), pixelRatio capé
  (high 1.5 / med 1.25 / low 1), ombres soleil 2048 uniquement, auto-qualité
  (fps < 45 pendant 5 s → baisse pixelRatio/ombres), compteur FPS discret (F3)

### Agent PERSOS (branche `gfx-chars`)
Scope : `src/game/render/PlayersRenderer.ts`, `src/game/render/WeaponView.ts`,
`src/game/render/Effects.ts`. NE PAS toucher map.ts ni Renderer.ts.
- Soldats humanoïdes procéduraux : torse capsule + gilet, tête casque + visière,
  bras/jambes cylindres, accents couleur d'équipe, pseudo sprite
- Animations : marche/course (balancement membres ∝ vitesse), crouch, mort (chute)
- Viewmodels armes détaillés : canon cylindrique, receiver biseauté, chargeur,
  crosse, rail, viseur (AR/SMG/sniper/pistolet silhouettes distinctes),
  ADS aligné visée, reload (chargeur bas + haut), recul, sway, bob, sprint tilt
- Effets : muzzle flash (sprite+light bref), étincelles impact, tracantes lumineuses,
  étuis éjectés (petites pièces avec gravité), puff sang discret

### Intégration (lead)
Merge → check/build/E2E 61 assertions → VÉRIFICATION VISUELLE navigateur
(screenshots multi-angles en jeu) → fix → version → livraison.
