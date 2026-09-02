#!/usr/bin/env bash
# Install Amni-Connect on Linux from GitHub Releases (AppImage by default).
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Amnibro/Amni-Connect/main/scripts/install-linux.sh | bash
#   curl -fsSL ... | bash -s -- --deb
#   curl -fsSL ... | bash -s -- --rpm
set -euo pipefail

REPO="${AMNI_CONNECT_REPO:-Amnibro/Amni-Connect}"
MODE="appimage"
DEST_DIR="${AMNI_CONNECT_DIR:-$HOME/.local/bin}"
APPIMAGE_NAME="Amni-Connect.AppImage"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deb) MODE="deb"; shift ;;
    --rpm) MODE="rpm"; shift ;;
    --appimage) MODE="appimage"; shift ;;
    --dir) DEST_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: install-linux.sh [--appimage|--deb|--rpm] [--dir DIR]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Need $1 on PATH" >&2; exit 1; }
}
need curl
need grep
need sed

api="https://api.github.com/repos/${REPO}/releases/latest"
echo "Fetching latest release from ${REPO}…"
json=$(curl -fsSL "$api")

pick_asset() {
  local needle="$1"
  printf '%s' "$json" | grep -oE "\"browser_download_url\": \"[^\"]+${needle}\"" | head -n1 | sed -E 's/.*"browser_download_url": "([^"]+)".*/\1/'
}

case "$MODE" in
  appimage)
    url=$(pick_asset '\.AppImage')
    [[ -n "$url" ]] || { echo "No AppImage on the latest release" >&2; exit 1; }
    mkdir -p "$DEST_DIR"
    out="${DEST_DIR}/${APPIMAGE_NAME}"
    echo "Downloading $url"
    curl -fL --progress-bar -o "$out" "$url"
    chmod +x "$out"
    desktop_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    mkdir -p "$desktop_dir"
    cat > "${desktop_dir}/amni-connect.desktop" <<EOF
[Desktop Entry]
Name=Amni-Connect
Comment=E2EE peer-to-peer remote desktop
Exec=${out}
Icon=amni-connect
Terminal=false
Type=Application
Categories=Network;RemoteAccess;
StartupWMClass=amni-connect
EOF
    echo
    echo "Installed: $out"
    echo "Desktop entry: ${desktop_dir}/amni-connect.desktop"
    echo "Run: $out"
    echo "First launch on Wayland may ask which screen to share (PipeWire portal)."
    ;;
  deb)
    url=$(pick_asset '\.deb')
    [[ -n "$url" ]] || { echo "No .deb on the latest release" >&2; exit 1; }
    tmp=$(mktemp /tmp/amni-connect-XXXXXX.deb)
    echo "Downloading $url"
    curl -fL --progress-bar -o "$tmp" "$url"
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -y "$tmp"
    else
      sudo dpkg -i "$tmp" || sudo apt-get install -f -y
    fi
    rm -f "$tmp"
    echo "Installed via .deb. Launch: amni-connect"
    ;;
  rpm)
    url=$(pick_asset '\.rpm')
    [[ -n "$url" ]] || { echo "No .rpm on the latest release" >&2; exit 1; }
    tmp=$(mktemp /tmp/amni-connect-XXXXXX.rpm)
    echo "Downloading $url"
    curl -fL --progress-bar -o "$tmp" "$url"
    if command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y "$tmp"
    elif command -v zypper >/dev/null 2>&1; then
      sudo zypper install -y "$tmp"
    else
      sudo rpm -Uvh "$tmp"
    fi
    rm -f "$tmp"
    echo "Installed via .rpm. Launch: amni-connect"
    ;;
esac
