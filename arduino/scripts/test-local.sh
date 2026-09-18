#!/usr/bin/env bash
#
# Run the connector's Python tests (model + HTTP smoke). No board required.
#
# Usage:  arduino/scripts/test-local.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # arduino/
cd "${HERE}"
exec python3 -m unittest discover -s tests -p 'test_*.py' -v
