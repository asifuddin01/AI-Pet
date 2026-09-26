#!/usr/bin/env bash
# One-time setup for building AI Pet on macOS. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
todo() { printf "  \033[33m→\033[0m %s\n" "$1"; missing=1; }
missing=0

echo "Checking prerequisites…"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is for macOS." >&2
  exit 1
fi

major=$(sw_vers -productVersion | cut -d. -f1)
if (( major >= 13 )); then ok "macOS $(sw_vers -productVersion)"; else todo "macOS 13 Ventura or later is required"; fi

if xcode-select -p >/dev/null 2>&1; then ok "Xcode Command Line Tools"; else todo "Install Xcode Command Line Tools:  xcode-select --install"; fi

if command -v rustup >/dev/null 2>&1; then
  ok "Rust $(rustc --version | cut -d' ' -f2)"
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
  ok "Rust targets for a universal build"
else
  todo "Install Rust:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi

if command -v node >/dev/null 2>&1 && (( $(node -p 'process.versions.node.split(".")[0]') >= 20 )); then
  ok "Node.js $(node --version)"
else
  todo "Install Node.js 20 or later (https://nodejs.org or: brew install node)"
fi

if (( missing )); then
  echo
  echo "Install the items marked → and run this script again."
  exit 1
fi

echo
echo "Installing JavaScript dependencies…"
npm install

cat <<'EOF'

All set! Next:

  npm run tauri dev      # run the pet (first build takes a few minutes)
  npm run app:build      # build the universal .app / .dmg

Then grant Accessibility access when the pet asks, and set up your AI provider
in Settings (right-click the pet → Settings…).
EOF
