#!/usr/bin/env bash
# Install the HexagonNPUCity Bench App on the board and register the host-side
# sweep service.
#
# Usage: arduino/scripts/bench-deploy.sh [user@host] [ssh-key]
set -euo pipefail

TARGET="${1:-arduino@echoglow-eoin}"
KEY="${2:-${HOME}/.ssh/id_ed25519_echoglow}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # arduino/
APP="hexagon_npu_simcity"
REMOTE_APP="ArduinoApps/${APP}"
# Any preinstalled example ships the WebUI brick's browser libraries.
BRICK_LIBS="/var/lib/arduino-app-cli/examples/inspirational/platform_unoq/color-your-leds/assets/libs"

ssh_() { ssh -o BatchMode=yes -i "${KEY}" "${TARGET}" "$@"; }

echo "== copying the App to ${TARGET}:~/${REMOTE_APP} =="
ssh_ "mkdir -p ~/${REMOTE_APP}/data ~/hexsim"
scp -q -i "${KEY}" -r "${HERE}/bench/." "${TARGET}:~/${REMOTE_APP}/"
scp -q -i "${KEY}" "${HERE}/scripts/bench-sweep.py" "${TARGET}:~/hexsim/sweep.py"
ssh_ "chmod +x ~/hexsim/sweep.py"

# Copied from the board rather than vendored, so they always match the brick.
echo "== copying the WebUI brick's browser libraries =="
ssh_ "mkdir -p ~/${REMOTE_APP}/assets/libs && cp -f ${BRICK_LIBS}/* ~/${REMOTE_APP}/assets/libs/ && ls ~/${REMOTE_APP}/assets/libs"

echo "== installing the sweep as a user service =="
ssh_ "bash -lc '
set -e
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/hexsim-sweep.service <<UNIT
[Unit]
Description=llama.cpp quantization sweep for HexagonNPUCity Bench
After=network-online.target

[Service]
Type=simple
ExecStart=%h/hexsim/venv/bin/python %h/hexsim/sweep.py --loop 900
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now hexsim-sweep.service
systemctl --user --no-pager status hexsim-sweep.service | head -6
'" || echo "(systemd user session unavailable; run ~/hexsim/sweep.py manually)"

echo
echo "Done. App Lab runs one App at a time; start this one with:"
echo "  ssh ${TARGET} 'arduino-app-cli app start user:${APP}'"
echo "UI: http://${TARGET#*@}:7000"
