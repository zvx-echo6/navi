#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm run build
rsync -av --delete dist/ /mnt/nav/frontend/
echo "Deployed to /mnt/nav/frontend/"
