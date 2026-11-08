#!/usr/bin/env bash
set -euo pipefail

bash "$(dirname "$0")/prepare-wine.sh"

if ! command -v gh >/dev/null; then
  if ! command -v apt-get >/dev/null; then
    echo '::error::Install GitHub CLI (gh) on this runner before publishing releases.'
    exit 1
  fi
  root_command=()
  if [ "$(id -u)" != 0 ]; then
    if ! command -v sudo >/dev/null || ! sudo -n true 2>/dev/null; then
      echo '::error::Installing GitHub CLI requires root or passwordless sudo.'
      exit 1
    fi
    root_command=(sudo -n)
  fi
  "${root_command[@]}" apt-get update
  "${root_command[@]}" env DEBIAN_FRONTEND=noninteractive \
    apt-get install -y --no-install-recommends gh
fi
gh --version
