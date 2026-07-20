# Plan d'exécution — FPS 3D multijoueur WebSocket (style Black Ops 2)

## Objectif
FPS 3D multijoueur jouable dans le navigateur, serveur autoritaire Node.js + WebSocket,
une map 3-lane style BO2, mode TDM, 3 armes, netcode temps réel.
Livrable : projet full-stack avec Dockerfile → version via website_version_manager (type: dynamic).

## Scope (MVP+ sur UNE map, selon les étapes validées avec l'utilisateur)
1. Mouvement FPS (WASD, sprint, saut, crouch) + régénération santé
2. Netcode : serveur autoritaire, prédiction client, interpolation, lag compensation
3. Tir hitscan, dégâts zonés (headshot x2), hitmarkers, mort/respawn + spawn protection
4. TDM (2 équipes, score cible + timer), HUD complet (crosshair, killfeed, scoreboard, minimap)
5. 3 armes (AR type AN-94, SMG type MSMC, Sniper type DSR-50) + pistolet : ADS, recul, reload
6. Sélection de classe simplifiée (menu loadout), UAV scorestreak, killcam simple
7. Audio procédural WebAudio (tirs, hits, pas, annonces), DA orange/bleu futuriste 2025

## Stack
- Client : React + TypeScript + Vite + Three.js (rendu), Zustand (state UI), Tailwind (menus/HUD)
- Serveur : Node.js + `ws` (WebSocket natif), boucle tick 30 Hz, logique de jeu autoritaire
- Monorepo : /client (Vite React) + /server (Node ESM) + Dockerfile multi-stage unique

## Stages & skills (chargement progressif)

### Stage 0 — Setup
- Skill: swarm-workspace → repo git partagé + worktrees par subagent

### Stage 1 — Design & architecture (skill: vibecoding-webapp-swarm)
- Subagent `plan` : game design doc technique — protocole réseau (messages JSON binaires?),
  layout de la map 3-lane (type Hijacked/Nuketown), palette DA BO2 2025, arbre de composants
- Gate: valider protocole + layout avant de coder

### Stage 2 — Frontend (skill: webapp-building-swarm, worktree A)
- Subagent `coder` : client FPS complet — rendu Three.js (map, lumières, skybox),
  contrôleur FPS (pointer lock, sprint/saut/crouch), vue arme 3D procédurale + ADS + recul,
  HUD React (crosshair, killfeed, scoreboard, minimap canvas, écran loadout, killcam),
  audio WebAudio procédural, netcode client (prédiction, interpolation)

### Stage 3 — Backend (skill: backend-building-swarm adapté WS, worktree B)
- Subagent `coder` : serveur Node + ws — rooms, tick 30 Hz, état monde, mouvement validé,
  hitscan avec lag compensation, TDM scoring, respawns/spawn protection, UAV,
  servir le build client statique (Dockerfile unique)

### Stage 4 — Intégration & polish (worktree A ou agent dédié)
- Brancher client↔serveur (protocole commun /shared), équilibrage armes,
  vérifier build, smoke test local (node server + 2 clients simulés)

### Stage 5 — Review, tests E2E & livraison
- Subagent `verifier` : lancer le serveur, connecter des bots WS headless, vérifier
  mouvement/tir/mort/score/respawn/UAV, build client OK
- Fix si échec (redelegate)
- Livraison : mshtools-website_version_manager build_version type=dynamic

## Règles
- Les outputs de chaque stage sont passés explicitement au suivant (A2A)
- Recherche ≠ écriture : design d'abord, code ensuite
- Validation binaire à chaque gate
