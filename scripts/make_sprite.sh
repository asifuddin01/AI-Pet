#!/usr/bin/env bash
# One-step wrapper for make_sprite.py. The first run creates a private Python environment
# in .venv-sprites (ignored by git) and installs what the converter needs; later runs go
# straight to converting. Works from any folder:
#
#   ~/AI/PET/scripts/make_sprite.sh ~/Downloads/lucy.mp4 ~/Desktop/idle.webp --start 0.5 --end 2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.venv-sprites"
REQS="$ROOT/scripts/requirements-sprites.txt"
STAMP="$VENV/.installed"

if [ ! -f "$STAMP" ] || ! cmp -s "$REQS" "$STAMP"; then
  PY=""
  for candidate in python3.13 python3.12 python3.14 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1 &&
      "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      PY="$candidate"
      break
    fi
  done
  if [ -z "$PY" ]; then
    echo "Python 3.11 or newer is needed. Install it with: brew install python" >&2
    exit 1
  fi
  echo "Setting up the converter with $("$PY" --version) (first run only, a few minutes)…"
  [ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --quiet --upgrade pip
  "$VENV/bin/python" -m pip install --quiet -r "$REQS"
  cp "$REQS" "$STAMP"
fi

exec "$VENV/bin/python" "$ROOT/scripts/make_sprite.py" "$@"
