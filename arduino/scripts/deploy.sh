#!/usr/bin/env bash
#
# Build the web app and deploy the HexagonNPUCity connector to the UNO Q.
#
# Overlays our Python + sketch + the built sim onto the App Lab app, then
# (re)starts it via the Arduino App CLI. Keyless SSH must be set up first
# (see setup-ssh.sh). The device's App Lab-managed sketch.yaml is preserved.
#
# Usage:  arduino/scripts/deploy.sh [host]
# Default host: echoglow-eoin
set -euo pipefail

HOST="${1:-echoglow-eoin}"
APP_NAME="HexagonNPUCity"
REMOTE_APPS="/home/arduino/ArduinoApps"
APP_DIR="${REMOTE_APPS}/${APP_NAME}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # arduino/
REPO="$(cd "${HERE}/.." && pwd)"                          # repo root

echo "==> Checking SSH to ${HOST}"
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "${HOST}" true 2>/dev/null; then
  echo "!! Cannot reach ${HOST} over keyless SSH. Run arduino/scripts/setup-ssh.sh first." >&2
  exit 1
fi

echo "==> Building the web app"
( cd "${REPO}" && npm run build )

echo "==> Staging connector + web build"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
cp -R "${HERE}/app/." "${STAGE}/"
mkdir -p "${STAGE}/python/web"
cp -R "${REPO}/dist/." "${STAGE}/python/web/"

echo "==> Ensuring ${APP_DIR} exists on the board"
ssh "${HOST}" "mkdir -p '${APP_DIR}/python' '${APP_DIR}/sketch'"

echo "==> Syncing Python (incl. built sim) to ${HOST}"
ssh "${HOST}" "rm -rf '${APP_DIR}/python/web'"
rsync -az "${STAGE}/python/" "${HOST}:${APP_DIR}/python/"

echo "==> Syncing sketch source"
rsync -az "${STAGE}/sketch/sketch.ino" "${HOST}:${APP_DIR}/sketch/sketch.ino"
# Only install our sketch.yaml if App Lab hasn't already managed one on-device.
if ! ssh "${HOST}" "test -f '${APP_DIR}/sketch/sketch.yaml'"; then
  rsync -az "${STAGE}/sketch/sketch.yaml" "${HOST}:${APP_DIR}/sketch/sketch.yaml"
fi

echo "==> Installing app.yaml"
rsync -az "${STAGE}/app.yaml" "${HOST}:${APP_DIR}/app.yaml"
[[ -f "${STAGE}/README.md" ]] && rsync -az "${STAGE}/README.md" "${HOST}:${APP_DIR}/README.md"

echo "==> Starting the App via the Arduino App CLI"
ssh "${HOST}" "arduino-app-cli app restart '${APP_DIR}' || arduino-app-cli app start '${APP_DIR}'"

echo ""
echo "==> Deployed. View the sim at:  http://${HOST}:7080/"
echo "    Logs:     ssh ${HOST} \"arduino-app-cli app logs '${APP_DIR}' --follow\""
echo "    Startup:  ssh ${HOST} \"arduino-app-cli properties set default user:${APP_NAME}\""
