#!/usr/bin/env bash
# Full local quality gate for NEON STREET.
# Usage: bash scripts/verify.sh [--with-e2e]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="/c/Users/SovLy/.local/bin:/c/Users/SovLy/.cargo/bin:$PATH"

step() { printf '\n\033[1;35m== %s ==\033[0m\n' "$1"; }

step "cargo test (pure Rust simulation)"
cargo test --all

step "wasm-pack build"
npm run build:wasm

step "wasm size"
ls -l web/pkg/neon_street_bg.wasm

step "typecheck (tsc --noEmit)"
npm run typecheck

step "frontend build"
npx vite build

if [[ "${1:-}" == "--with-e2e" ]]; then
  step "playwright e2e"
  npx playwright test
fi

step "OK"
