#!/usr/bin/env bash
# Checks that every download the QR codes encode resolves through the
# version-independent releases/latest/download/<asset> URL.
set -u

BASE="https://github.com/eoinjordan/HexagonNPUSimCity/releases/latest/download"
ASSETS="HexagonNPUSimCity-arm64-cpu-preview.apk HexagonNPUSimCity-arm64.msi HexagonNPUSimCity-all.deb HexagonNPUSimCity-web.zip SHA256SUMS"

fail=0
for asset in $ASSETS; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -L "$BASE/$asset")
  printf '%-45s %s\n' "$asset" "$code"
  [ "$code" = "200" ] || fail=1
done
exit "$fail"
