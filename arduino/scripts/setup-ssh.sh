#!/usr/bin/env bash
#
# Set up keyless SSH from this machine to the Arduino UNO Q.
#
# Idempotent: reuses the dedicated echoglow key if present, adds a Host alias to
# ~/.ssh/config, then installs the public key on the board. ssh-copy-id will ask
# for the board's Linux password ONCE — type it directly into your terminal
# (this script never handles it).
#
# Usage:  arduino/scripts/setup-ssh.sh [host] [user]
# Default host: echoglow-eoin   Default user: arduino
set -euo pipefail

HOST="${1:-echoglow-eoin}"
USER_NAME="${2:-arduino}"
KEY="${HOME}/.ssh/id_ed25519_echoglow"
CONFIG="${HOME}/.ssh/config"

# 1) Ensure a key exists (reuse the dedicated echoglow key if you already have one).
if [[ ! -f "$KEY" ]]; then
  echo "==> Generating SSH key $KEY"
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "hexagon-npu-city@$(hostname)"
else
  echo "==> Reusing existing key $KEY"
fi

# 2) Ensure a Host alias in ~/.ssh/config (idempotent, backed up).
mkdir -p "$(dirname "$CONFIG")"
touch "$CONFIG"
chmod 600 "$CONFIG"
if ! grep -qiE "^[[:space:]]*Host[[:space:]]+${HOST}([[:space:]]|$)" "$CONFIG"; then
  echo "==> Adding 'Host ${HOST}' to $CONFIG (backup: ${CONFIG}.bak)"
  cp "$CONFIG" "${CONFIG}.bak" 2>/dev/null || true
  cat >> "$CONFIG" <<EOF

# Added by HexagonNPUCity arduino connector — edit HostName if mDNS isn't available.
Host ${HOST}
    HostName ${HOST}.local
    User ${USER_NAME}
    IdentityFile ${KEY}
    IdentitiesOnly yes
EOF
else
  echo "==> 'Host ${HOST}' already in $CONFIG (leaving as-is)"
fi

# 3) Install the public key on the board (prompts for the board password once).
echo "==> Installing public key on ${USER_NAME}@${HOST}"
echo "    (you'll be asked for the board's Linux password — type it in the terminal)"
if ! ssh-copy-id -i "${KEY}.pub" "${HOST}"; then
  echo "!! ssh-copy-id failed. Is the board powered on and reachable?" >&2
  echo "   Try:  ssh ${HOST}    — if the name doesn't resolve, edit HostName in ${CONFIG}" >&2
  echo "   (use the board's IP address or Tailscale name)." >&2
  exit 1
fi

# 4) Verify passwordless login.
echo "==> Verifying passwordless login"
ssh -o BatchMode=yes "${HOST}" 'echo "OK: logged in to $(hostname) as $(whoami)"'
echo "==> Keyless SSH to ${HOST} is ready. Next: arduino/scripts/deploy.sh"
