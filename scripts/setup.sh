#!/usr/bin/env bash
# Audifree setup for CachyOS / Arch (works on other Arch-based distros).
#
#   bash scripts/setup.sh                 # install system deps, venv, npm deps
#   bash scripts/setup.sh --skip-pacman   # only venv + npm deps
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_PACMAN=0

for arg in "$@"; do
  case "$arg" in
    --skip-pacman) SKIP_PACMAN=1 ;;
    -h|--help)
      sed -n '2,9p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

say() { printf '\n\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }

# --- 1. system packages -----------------------------------------------------
if [[ "$SKIP_PACMAN" -eq 0 ]]; then
  if command -v pacman >/dev/null 2>&1; then
    say "Installing system packages (sudo required)"
    # python-pip is provided by python on current Arch; --needed keeps this fast.
    sudo pacman -S --needed --noconfirm python python-pip nodejs npm ffmpeg yt-dlp
  else
    warn "pacman not found - skipping system packages."
  fi
else
  say "Skipping pacman (-skip-pacman)"
fi

for tool in python3 node npm; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing required tool: $tool" >&2
    exit 1
  }
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  warn "Node $(node -v) detected; Electron/Vite need Node >= 22.12."
fi

# --- 2. Python sidecar venv -------------------------------------------------
VENV="$ROOT/backend/.venv"
say "Creating Python venv at backend/.venv"
python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
say "Installing backend dependencies"
"$VENV/bin/python" -m pip install -r "$ROOT/backend/requirements.txt"

# --- 3. Node dependencies ---------------------------------------------------
say "Installing npm dependencies (this also downloads the Electron binary)"
cd "$ROOT"
npm install

# Electron 45 ships no postinstall hook; make sure the binary exists.
if [[ ! -x "$ROOT/node_modules/electron/dist/electron" ]]; then
  say "Fetching the Electron binary"
  npx --no-install install-electron
fi

# --- 4. smoke check ---------------------------------------------------------
say "Verifying the backend imports"
(cd "$ROOT/backend" && "$VENV/bin/python" - <<'PY'
from app.providers import YouTubeMusicProvider  # noqa: F401
from app.main import app  # noqa: F401
print("backend imports OK")
PY
)

say "Done. Start the app with: npm run dev"
warn "Unofficial scrapers: if search or playback stops working, use the in-app"
warn "'Update yt-dlp' button or run: backend/.venv/bin/pip install -U yt-dlp ytmusicapi"
