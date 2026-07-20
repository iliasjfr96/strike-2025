#!/usr/bin/env bash
# ============================================================================
# STRIKE 2025 — installation sur VPS (Ubuntu/Debian, exécuter en root).
#
#   bash vps-setup.sh                  -> jeu servi sur http://IP-DU-VPS
#   bash vps-setup.sh mondomaine.com   -> jeu servi sur https://mondomaine.com
#                                         (HTTPS automatique via Caddy — le
#                                         domaine doit déjà pointer sur le VPS)
#
# Idempotent : relançable sans risque (met à jour le code et redémarre).
# Installe : Node 20, le jeu (service systemd), Caddy (reverse proxy + TLS).
# Données persistantes (maps, imports, code admin) : /opt/strike-2025/app/data
# ============================================================================
set -euo pipefail

DOMAIN="${1:-}"
REPO="https://github.com/iliasjfr96/strike-2025.git"
DIR=/opt/strike-2025

echo "=== [1/5] Paquets de base ==="
apt-get update -y
apt-get install -y git curl ca-certificates

echo "=== [2/5] Node.js 20 ==="
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "=== [3/5] Code du jeu ==="
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi
cd "$DIR/app"
npm ci
npm run build

echo "=== [4/5] Service systemd ==="
cat > /etc/systemd/system/strike2025.service <<EOF
[Unit]
Description=STRIKE 2025 (FPS multijoueur navigateur)
After=network.target

[Service]
WorkingDirectory=$DIR/app
Environment=PORT=3000
ExecStart=$(command -v node) dist-server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable strike2025 >/dev/null
systemctl restart strike2025

echo "=== [5/5] Caddy (reverse proxy + HTTPS auto) ==="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
if [ -n "$DOMAIN" ]; then
  printf '%s {\n\treverse_proxy 127.0.0.1:3000\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
else
  printf ':80 {\n\treverse_proxy 127.0.0.1:3000\n}\n' > /etc/caddy/Caddyfile
fi
systemctl enable caddy >/dev/null
systemctl restart caddy

# Pare-feu (si ufw actif) : web ouvert, le port 3000 reste interne.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

sleep 2
echo
echo "============================================================"
echo " STRIKE 2025 déployé — service : $(systemctl is-active strike2025)"
if [ -n "$DOMAIN" ]; then
  echo " URL : https://$DOMAIN"
else
  echo " URL : http://$(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')"
fi
echo " Code ADMIN : $(cat "$DIR/app/data/admin-token.txt" 2>/dev/null || echo "voir $DIR/app/data/admin-token.txt après 1er lancement")"
echo " Mise à jour : bash $DIR/deploy/vps-update.sh"
echo "============================================================"
