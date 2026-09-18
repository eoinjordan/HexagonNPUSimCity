#!/usr/bin/env bash
#
# Run the connector's HTTP host locally (on this machine) to preview exactly
# what the UNO Q would serve. Builds the web app first if needed.
#
# Usage:  arduino/scripts/run-local.sh
# Then open http://localhost:7080/
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # arduino/
REPO="$(cd "${HERE}/.." && pwd)"                          # repo root

if [[ ! -d "${REPO}/dist" ]]; then
  echo "==> Building the web app"
  ( cd "${REPO}" && npm run build )
fi

echo "==> Serving ${REPO}/dist on http://localhost:${HEXAGON_PORT:-7080}/  (Ctrl-C to stop)"
cd "${HERE}/app/python"
HEXAGON_WEB_ROOT="${REPO}/dist" exec python3 server.py
