#!/usr/bin/env bash
# STRIKE 2025 — mise à jour du VPS : récupère le dernier code GitHub,
# rebuild et redémarre le service. (Les données data/ sont conservées.)
set -euo pipefail
cd /opt/strike-2025
git pull --ff-only
cd app
npm ci
npm run build
systemctl restart strike2025
sleep 2
echo "Service : $(systemctl is-active strike2025) — $(curl -s http://127.0.0.1:3000/healthz)"
