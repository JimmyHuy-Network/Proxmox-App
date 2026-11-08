#!/usr/bin/env bash
set -euo pipefail

if ! command -v wine >/dev/null; then
  if ! command -v apt-get >/dev/null || ! command -v dpkg >/dev/null; then
    echo '::error::Install Wine on this runner; automatic setup supports Debian/Ubuntu only.'
    exit 1
  fi
  root_command=()
  if [ "$(id -u)" != 0 ]; then
    if ! command -v sudo >/dev/null || ! sudo -n true 2>/dev/null; then
      echo '::error::Wine setup requires root or passwordless sudo. Install wine, wine64, wine32:i386, xvfb and xauth on the runner, then rerun CI.'
      exit 1
    fi
    root_command=(sudo -n)
  fi
  # NSIS runs 32-bit Windows helper executables even for an x64 installer.
  "${root_command[@]}" dpkg --add-architecture i386
  "${root_command[@]}" apt-get update
  "${root_command[@]}" env DEBIAN_FRONTEND=noninteractive \
    apt-get install -y --no-install-recommends wine wine64 wine32:i386 xvfb xauth
fi

# Keep build-only Wine state out of the runner account's normal Wine profile.
export WINEPREFIX="${RUNNER_TEMP:?RUNNER_TEMP must be set}/proxmox-wine"
export WINEDEBUG=-all,err+all
export WINEDLLOVERRIDES=winemenubuilder.exe=d
if [ -n "${GITHUB_ENV:-}" ]; then
  printf 'WINEPREFIX=%s\nWINEDEBUG=%s\nWINEDLLOVERRIDES=%s\n' \
    "$WINEPREFIX" "$WINEDEBUG" "$WINEDLLOVERRIDES" >> "$GITHUB_ENV"
fi
wine --version
if command -v xvfb-run >/dev/null; then
  timeout 120 xvfb-run -a wine cmd /c exit 0
else
  timeout 120 wine cmd /c exit 0
fi
