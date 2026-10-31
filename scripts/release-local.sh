#!/usr/bin/env bash
# Local replacement for .github/workflows/release.yml (disabled 2026-10-30).
# Builds the same release files on Anthony's Linux PC, no GitHub Actions:
#   Linux:   rust/amni-control  -> dist/Amni-Connect-<ver>.AppImage, .deb (.rpm if rpmbuild is installed)
#   Windows: rust/amni-control.exe (x86_64-pc-windows-gnu + mingw) -> dist/Amni-Connect-Setup-<ver>.exe
#            (electron-builder NSIS runs under wine on Linux)
# Usage: scripts/release-local.sh [all|linux|windows] [--publish]
#   --publish  stages dist/ into artifacts/ and runs scripts/publish-release.sh (needs `gh auth login`).
set -euo pipefail
cd "$(dirname "$0")/.."
PLATFORMS=all; PUBLISH=0
for a in "$@"; do case "$a" in --publish) PUBLISH=1 ;; all|linux|windows) PLATFORMS=$a ;; *) echo "unknown arg $a" >&2; exit 2 ;; esac; done
export CSC_IDENTITY_AUTO_DISCOVERY=false
ver=$(node -p "require('./package.json').version")
echo "Amni-Connect $ver ($PLATFORMS)"
mkdir -p build
npm ci
if [ "$PLATFORMS" != windows ]; then
  cargo build --release --manifest-path rust/Cargo.toml
  install -m 755 rust/target/release/amni-control build/amni-control
  targets=(AppImage deb)
  if command -v rpmbuild >/dev/null; then targets+=(rpm); else echo "rpmbuild not installed: skipping .rpm"; fi
  node scripts/make-icon.js
  npx electron-builder --linux "${targets[@]}" --publish never
fi
if [ "$PLATFORMS" != linux ]; then
  rustup target list --installed 2>/dev/null | grep -qx x86_64-pc-windows-gnu || rustup target add x86_64-pc-windows-gnu
  CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=${CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER:-x86_64-w64-mingw32-gcc} \
    cargo build --release --manifest-path rust/Cargo.toml --target x86_64-pc-windows-gnu
  cp rust/target/x86_64-pc-windows-gnu/release/amni-control.exe build/amni-control.exe
  node scripts/make-icon.js
  npx electron-builder --win nsis --publish never
fi
ls -la dist | grep -E "Amni-Connect.*$ver|latest" || true
if [ "$PUBLISH" = 1 ]; then
  rm -rf artifacts aliases && mkdir -p artifacts
  cp dist/Amni-Connect*"$ver"* dist/latest*.yml artifacts/ 2>/dev/null || true
  bash scripts/publish-release.sh
fi
