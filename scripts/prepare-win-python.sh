#!/usr/bin/env bash
# Assemble the Windows Python runtime that gets bundled into the .exe.
#
#   bash scripts/prepare-win-python.sh
#
# Downloads the embeddable CPython 3.12 distribution (no installer, ~11 MB) and
# installs the backend requirements as win_amd64 wheels into it, using uv's
# cross-platform resolver so this can run on Linux while producing a Windows
# runtime.  Writes backend/runtime/win/python (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY_VERSION="${AUDIFREE_WIN_PYTHON:-3.12.10}"
PY_SHORT="${PY_VERSION%.*}"
PY_SHORT="${PY_SHORT/./}" # 3.12 -> 312
DEST="$ROOT/backend/runtime/win/python"
ZIP="/tmp/python-$PY_VERSION-embed-amd64.zip"

command -v uv >/dev/null 2>&1 || {
  echo "uv is required (https://docs.astral.sh/uv/): pacman -S uv / pip install uv" >&2
  exit 1
}

say() { printf '\n\033[1;35m==>\033[0m %s\n' "$*"; }

if [[ ! -f "$ZIP" ]]; then
  say "Downloading CPython $PY_VERSION (embeddable, amd64)"
  curl -sSL -o "$ZIP" "https://www.python.org/ftp/python/$PY_VERSION/python-$PY_VERSION-embed-amd64.zip"
fi

say "Unpacking into backend/runtime/win/python"
rm -rf "$DEST"
mkdir -p "$DEST/Lib/site-packages"
unzip -q "$ZIP" -d "$DEST"

# The embeddable build is isolated and does not add the working directory to
# sys.path, so list the backend roots explicitly: `..` for the packaged layout
# (resources/backend/python -> resources/backend) and `..\..\..` for this
# repository layout (backend/runtime/win/python -> backend).
cat >"$DEST/python$PY_SHORT._pth" <<'PTH'
python312.zip
.
..
..\..\..
Lib\site-packages
import site
PTH

say "Installing win_amd64 dependencies"
uv pip install --quiet \
  --target "$DEST/Lib/site-packages" \
  --python-platform x86_64-pc-windows-msvc \
  --python-version 3.12 \
  -r "$ROOT/backend/requirements.txt" pip

# uv writes POSIX entry-point shims; Windows uses .exe launchers, and the app
# only invokes `python -m pip`.
rm -rf "$DEST/bin" "$DEST/share"

say "Done: $(du -sh "$DEST" | cut -f1) in backend/runtime/win/python"
