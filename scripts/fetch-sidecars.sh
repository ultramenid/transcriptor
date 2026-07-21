#!/usr/bin/env bash
# Fetch ffmpeg/ffprobe sidecar binaries for the CURRENT platform into
# src-tauri/binaries/, named with the Tauri target triple so externalBin
# finds them at build/dev time. Mirrors what CI does in release.yml.
#
# Run once before `pnpm tauri dev` or `pnpm tauri build` on a machine that
# doesn't already have the binaries staged. Idempotent — safe to re-run.
#
#   usage: ./scripts/fetch-sidecars.sh [--force]
#
# Binaries come from eugeneware/ffmpeg-static (static, portable builds that
# only link against system libraries — no Homebrew/Chocolatey dependency).
set -euo pipefail

FFMPEG_TAG="b6.1.1"
BASE="https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_TAG}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${ROOT}/src-tauri/binaries"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# Detect the current platform and map it to the Tauri target triple +
# eugeneware arch name.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  TARGET="aarch64-apple-darwin";  ARCH="darwin-arm64" ;;
  Darwin-x86_64) TARGET="x86_64-apple-darwin";   ARCH="darwin-x64"   ;;
  Linux-x86_64)  TARGET="x86_64-unknown-linux-gnu"; ARCH="linux-x64" ;;
  Linux-aarch64) TARGET="aarch64-unknown-linux-gnu"; ARCH="linux-arm64" ;;
  MINGW*-x86_64|MSYS*-x86_64|CYGWIN*-x86_64)
                 TARGET="x86_64-pc-windows-msvc"; ARCH="win32-x64"   ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

# Windows sidecar binaries need an .exe suffix.
EXT=""
if [[ "${TARGET}" == *-pc-windows-* ]]; then EXT=".exe"; fi

mkdir -p "${BIN_DIR}"

for BIN in ffmpeg ffprobe; do
  OUT="${BIN_DIR}/${BIN}-${TARGET}${EXT}"
  if [[ -f "${OUT}" && "${FORCE}" -eq 0 ]]; then
    echo "✓ ${BIN}-${TARGET}${EXT} already present (use --force to refetch)"
    continue
  fi
  echo "↓ fetching ${BIN}-${ARCH} -> ${BIN}-${TARGET}${EXT}"
  curl -fL "${BASE}/${BIN}-${ARCH}" -o "${OUT}"
  chmod +x "${OUT}"
done

echo
echo "Sidecars ready in src-tauri/binaries/ for target ${TARGET}:"
ls -lh "${BIN_DIR}"