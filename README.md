# STRIKE 2025

FPS multijoueur dans le navigateur — Three.js + React côté client, serveur autoritaire Node.js en WebSocket. Match à mort par équipe 4v4 (bots inclus) sur **KESTREL YARD**, un triport ferroviaire, avec un mode création complet façon communauté.

## Fonctionnalités

- **Multijoueur temps réel** : serveur autoritaire 30 ticks/s, prédiction client à pas fixe 60 Hz avec réconciliation par ack, compensation de lag sur les tirs, bots 4v4 pour compléter les équipes.
- **Éditeur de map en jeu (mode BUILD)** : placement/déplacement/redimensionnement d'objets, édition des objets de la map de base, annulation, sauvegarde.
- **Import de contenu** : armes et objets de map custom (GLB, GLTF, FBX, OBJ, STL + textures PNG/JPG/WebP), calibrage avec aperçu 3D intégré, stats d'armes modifiables (bornées côté serveur).
- **Communauté** : publication de maps, bibliothèque partagée, salons multiples (une instance de jeu indépendante par salon), choix map de base ou terrain vide.
- **Panel admin** : gestion des salons, suppression de maps publiées, réinitialisation de la map principale, purge des fichiers importés, quotas anti-abus par IP.

## Lancer en développement

```bash
cd app
npm install
npm run dev
```

Puis ouvrir <http://localhost:5173> (sous Windows, `LANCER-LE-JEU.cmd` fait tout ça).

## Production

```bash
cd app
npm install
npm run build
npm start
```

Un seul process Node sert le jeu, le WebSocket, les API et les fichiers importés.

- `PORT` : port d'écoute (défaut 3000).
- `ADMIN_TOKEN` : code du panel admin (sinon auto-généré dans `data/admin-token.txt`, affiché au démarrage).
- Le dossier `data/` (maps publiées, imports des joueurs) doit être sur un **disque persistant**.

## Vérifications

```bash
npm run check     # typecheck TypeScript
npm run test:e2e  # test de bout en bout (serveur + bots headless, 61 assertions)
```

## Crédits

Assets 3D et textures sous licences CC-BY / CC0 — détail dans [app/CREDITS.md](app/CREDITS.md). Visuels d'opérateurs générés par IA.
