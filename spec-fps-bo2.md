# Spécifications fonctionnelles — FPS 3D multijoueur (style Black Ops 2)

**Projet** : FPS 3D multijoueur en temps réel via WebSocket, inspiré de Call of Duty: Black Ops 2 (gunplay nerveux, TTK rapide, système Pick 10, scorestreaks, maps 3-lane).

**Stack technique suggérée** :
- Client : Three.js ou Babylon.js (WebGL/WebGPU) — ou Godot/Unity si desktop
- Serveur : Node.js + `ws` ou framework Colyseus (gestion de rooms intégrée)
- Alternative réseau long terme : WebRTC DataChannel / WebTransport (UDP-like) — WebSocket (TCP) suffit pour le MVP
- BDD : PostgreSQL / SQLite (comptes, stats, progression)

---

## 1. Fenêtre de jeu & client
- [ ] Boucle de jeu 60 fps, logique découplée du rendu (fixed timestep)
- [ ] Rendu 3D temps réel, caméra FPS, bobbing, screen shake (explosions)
- [ ] Pointer Lock API, plein écran, multi-résolutions
- [ ] Paramètres : FOV (65–90), sensibilité souris (avec multiplicateur ADS), inversion Y, keybinds personnalisables
- [ ] Paramètres graphiques : qualité textures, ombres, anti-aliasing, distance d'affichage, limite fps
- [ ] Crosshair dynamique selon arme/stance

## 2. Mouvement & personnage
- [ ] Déplacement WASD, sprint, saut, accroupi, couché (prone)
- [ ] Dolphin dive (plongeon BO2)
- [ ] Santé 100 HP, régénération automatique après délai sans dégâts
- [ ] Hitboxes zonées : tête (multiplicateur), torse, membres
- [ ] Animations : idle, marche, course, saut, rechargement, changement d'arme, mort (ragdoll)
- [ ] Sons de pas selon surface, bruit de mouvement audible par les ennemis
- [ ] Chute de dégâts (fall damage) optionnelle

## 3. Armes & gunplay
### Catégories (inspirées BO2)
- [ ] Fusils d'assaut : type AN-94, M8A1 (rafale), MTAR, Type 25, FAL
- [ ] SMG : type MSMC, PDW-57, MP7, Chicom CQB, Skorpion EVO
- [ ] Snipers : type DSR 50, Ballista (bolt-action), SVU-AS, XPR-50
- [ ] LMG : type QBB LSW, LSAT, HAMR, Mk 48
- [ ] Shotguns : type KSG, R870 MCS, M1216, S12
- [ ] Pistolets : type Five-seven, Tac-45, B23R, KAP-40, Executioner
- [ ] Lanceurs : SMAW, RPG, FHJ-18 AA
- [ ] Spéciales : arbalète, ballistic knife, bouclier anti-émeute
### Mécaniques
- [ ] Tir hitscan (armes à balles) + projectiles physiques (lanceurs, grenades)
- [ ] Recul procédural (pattern vertical + aléatoire horizontal)
- [ ] Dispersion (spread) selon stance/mouvement
- [ ] ADS (visée épaulée) avec zoom, temps de transition par arme
- [ ] Hitmarkers visuels + sonores, multiplicateur headshot
- [ ] TTK rapide (2–5 balles au torse selon l'arme)
- [ ] Rechargement (annulable), munitions chargeur/réserve, ramassage de munitions
- [ ] Pénétration de surfaces fines (wallbang) selon calibre

## 4. Accessoires (attachments)
- [ ] Viseurs : reflex, ACOG, holo, Target Finder, MMS (scanner millimétrique), thermal
- [ ] Canons : silencieux (cache du radar), frein de bouche, canon long
- [ ] Sous-canon : poignée ergonomique, lance-grenades, laser (hip-fire)
- [ ] Chargeurs : étendu, rechargement rapide
- [ ] Munitions : FMJ (pénétration), blindées
- [ ] Crosse ajustable (strafe ADS), quickdraw (ADS plus rapide), tir rapide
- [ ] Limite : 2 accessoires par arme (3 avec wildcard Primary Gunfighter)

## 5. Système de classes — Pick 10
- [ ] 10 points à répartir : arme principale + accessoires, secondaire, perks (jusqu'à 6), létaux, tactiques, wildcards
- [ ] Perks Tier 1 : Poids plume, Gilet pare-éclats, Fantôme, Lignes dures, Aveuglé
- [ ] Perks Tier 2 : Mains leste, Charognard, Sang-froid, Robustesse, Câblé
- [ ] Perks Tier 3 : Dextérité, Conditionnement extrême, Silence de mort, Masque tactique, Ingénieur, Conscience
- [ ] Wildcards : Primary Gunfighter, Secondary Gunfighter, Perk 1/2/3 Greed, Overkill, Danger Close, Tactician
- [ ] Létaux : grenade frag, semtex, C4, tomahawk, bouncing betty, claymore
- [ ] Tactiques : flashbang, concussion, fumigène, EMP, shock charge, black hat, trophy system, insertion tactique
- [ ] Plusieurs slots de classes sauvegardés, édition entre les manches/en respawn

## 6. Scorestreaks (points marqués en vie, reset à la mort)
- [ ] UAV (radar) / Contre-UAV / EMP systems
- [ ] Hunter Killer drone, RC-XD
- [ ] Guardian (micro-ondes), Sentry Gun
- [ ] Lightning Strike, Hellstorm Missile
- [ ] War Machine, Death Machine
- [ ] Dragonfire, A.G.R., Stealth Chopper, Escort Drone
- [ ] Warthog, Lodestar, VTOL Warship, K9 Unit, Swarm
- [ ] UI d'appel (tablette/marqueur laser), annonces vocales alliées/ennemies

## 7. Maps & level design
- [ ] Design 3-lane (3 couloirs) avec connexions transversales
- [ ] Inspirations : Nuketown 2025, Hijacked, Raid, Standoff, Slums, Express, Meltdown, Yemen, Plaza, Carrier
- [ ] Couvertures destructibles visuellement, lignes de vue longues (snipers), zones CQC
- [ ] Emplacements d'objectifs : drapeaux Domination (A/B/C), sites de bombe S&D, zones Hardpoint rotatives
- [ ] Système de spawn intelligent : distance ennemie, ligne de vue, spawn protection courte, spawn flip
- [ ] Éléments interactifs : portes, volets, ascenseurs
- [ ] Ambiance futur proche 2025 (palette BO2 : orange/bleu/vert, néons discrets)

## 8. Modes de jeu
- [ ] Match à mort par équipe (TDM) — 100 points / limite de temps
- [ ] Mêlée générale (FFA)
- [ ] Domination — capture de 3 drapeaux, points par tick
- [ ] Recherche & Destruction — manches, pas de respawn, bombe
- [ ] Kill Confirmé — récupération de plaques
- [ ] Point Stratégique (Hardpoint) — zone rotative
- [ ] Capture du Drapeau
- [ ] Démolition, Quartier Général
- [ ] Party games : Jeu d'armes, Tireur d'élite, Une balle dans le chargeur, Bâtons et pierres
- [ ] Mode Hardcore : HUD minimal, friendly fire, 30 HP
- [ ] Ligue / Ranked avec règles compétitives
- [ ] (Bonus) Mode Zombies coopératif à vagues

## 9. Multijoueur & netcode
- [ ] Serveur autoritaire (autorité sur positions, tirs, dégâts)
- [ ] Rooms / lobbies avec code d'invitation, parties privées
- [ ] Matchmaking (ping, skill MMR) + navigateur de serveurs
- [ ] Prédiction client locale + réconciliation serveur
- [ ] Interpolation (entity interpolation ~100 ms) des joueurs distants
- [ ] Lag compensation : rewind des positions pour validation des tirs serveur
- [ ] Snapshots + delta compression, taux serveur 20–30 Hz, client 60 Hz
- [ ] Gestion déconnexion / reconnexion, spectateur
- [ ] Limite de joueurs par room : 12–18 (6v6 / 9v9 FFA)
- [ ] Chat texte (équipe/général), optionnellement chat vocal proximité
- [ ] Migration vers WebRTC/WebTransport si la latence TCP devient un problème

## 10. HUD & interface
- [ ] Réticule, hitmarkers, killfeed (icônes d'armes)
- [ ] Compteur munitions, nom d'arme, indicateur de streak
- [ ] Minimap radar (UAV, silencieux = invisible, Fantôme = invisible aux UAV)
- [ ] Scoreboard (TAB) : score, kills, morts, captures, ping
- [ ] Indicateur de dégâts directionnel, vignette de santé
- [ ] Killcam + final killcam (possibilité de skip)
- [ ] Annonces vocales et bannières (streaks, objectifs, overtime)
- [ ] Écran de fin : tableau final, XP gagnée, progression de défis
- [ ] Menus : accueil, création de classe, barracks (stats), options

## 11. Progression & méta-jeu
- [ ] XP par action (kill, objectif, assists), niveaux 1–55
- [ ] Prestige (jusqu'à 10) avec reset et récompenses
- [ ] Déblocage d'armes/perks par niveau + tokens de déblocage
- [ ] Défis d'armes → camouflages (or, diamant, headshots)
- [ ] Cartes de visite (calling cards), emblèmes personnalisables
- [ ] Statistiques : K/D, précision, SPM, WL, armes favorites

## 12. Audio
- [ ] Sons uniques par arme (tir, rechargement, silencieux)
- [ ] Spatialisation 3D (pas, tirs, explosions directionnels)
- [ ] Voix d'annonceur par équipe
- [ ] Musique de lobby, stingers de victoire/défaite
- [ ] Mixer : volumes master/SFX/musique/voix

## 13. Anti-triche & sécurité
- [ ] Validation serveur : cadence de tir, distance, vitesse de déplacement, téléportation
- [ ] Rate limiting des messages, vérification des tokens de session
- [ ] Jamais de confiance client (dégâts calculés serveur)
- [ ] Logs et système de signalement, kick/vote-kick

## 14. Performances
- [ ] LOD, occlusion culling, textures compressées
- [ ] Pooling d'objets (balles, particules, cadavres)
- [ ] Budget : < 100 Mo d'assets initiaux pour le web, chargement progressif
- [ ] Mode basse qualité pour machines faibles

---

## 📋 Roadmap MVP suggérée
| Étape | Contenu |
|---|---|
| 1 | Mouvement FPS solo + map grise (greybox) |
| 2 | Netcode : synchronisation de 2+ joueurs |
| 3 | Tir hitscan, dégâts, mort, respawn |
| 4 | TDM + HUD minimal + 3 armes (AR/SMG/sniper) |
| 5 | Classes Pick 10 simplifiées + UAV |
| 6 | Domination + S&D, killcam |
| 7 | Progression, stats, polish audio/visuel |
