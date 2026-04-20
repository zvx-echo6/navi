#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm run build
rsync -av --delete dist/ zvx@192.168.1.130:/mnt/nav/frontend/
echo "Deployed to recon-vm:/mnt/nav/frontend/"
