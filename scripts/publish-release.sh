#!/usr/bin/env bash
# Publish the GitHub Actions artifacts/ tree as a tagged GitHub Release.
# Lives in a real file so the workflow is not a YAML-indented heredoc (that
# never closed, so v1.6.9 and v1.6.10 built then failed at gh release create).
set -euo pipefail
ver=$(node -p "require('./package.json').version")
tag="v$ver"
mapfile -t files < <(find artifacts -type f \( \
  -name 'Amni-Connect-Setup-*.exe' -o \
  -name 'Amni-Connect-Setup-*.blockmap' -o \
  -name 'Amni-Connect-*.AppImage' -o \
  -name 'Amni-Connect-*.deb' -o \
  -name 'Amni-Connect-*.rpm' -o \
  -name 'latest.yml' -o \
  -name 'latest-linux.yml' \
\) | sort)
if [ ${#files[@]} -eq 0 ]; then
  echo "No artifacts to publish" >&2
  exit 1
fi
mkdir -p aliases
win_exe=$(find artifacts -type f -name "Amni-Connect-Setup-${ver}.exe" | head -n1 || true)
[ -n "$win_exe" ] && cp "$win_exe" aliases/Amni-Connect-Setup.exe
appimage=$(find artifacts -type f -name "Amni-Connect-${ver}.AppImage" | head -n1 || true)
[ -n "$appimage" ] && cp "$appimage" aliases/Amni-Connect.AppImage
deb=$(find artifacts -type f -name "Amni-Connect-${ver}.deb" | head -n1 || true)
[ -n "$deb" ] && cp "$deb" aliases/Amni-Connect.deb
rpm=$(find artifacts -type f -name "Amni-Connect-${ver}.rpm" | head -n1 || true)
[ -n "$rpm" ] && cp "$rpm" aliases/Amni-Connect.rpm
for f in aliases/Amni-Connect-Setup.exe aliases/Amni-Connect.AppImage aliases/Amni-Connect.deb aliases/Amni-Connect.rpm; do
  [ -f "$f" ] && files+=("$f")
done
notes="## Download

**Windows:** [Amni-Connect-Setup-${ver}.exe](https://github.com/Amnibro/Amni-Connect/releases/download/${tag}/Amni-Connect-Setup-${ver}.exe)

**Linux (pick one):**
- [AppImage](https://github.com/Amnibro/Amni-Connect/releases/download/${tag}/Amni-Connect-${ver}.AppImage) — most distros, chmod +x then run
- [.deb](https://github.com/Amnibro/Amni-Connect/releases/download/${tag}/Amni-Connect-${ver}.deb) — Debian / Ubuntu / Mint / Pop!_OS
- [.rpm](https://github.com/Amnibro/Amni-Connect/releases/download/${tag}/Amni-Connect-${ver}.rpm) — Fedora / RHEL / openSUSE

One-liner (AppImage):
\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/Amnibro/Amni-Connect/main/scripts/install-linux.sh | bash
\`\`\`

Viewer stays in any browser. Packaged hosts update from this Releases feed.
"
if gh release view "$tag" >/dev/null 2>&1; then
  gh release upload "$tag" "${files[@]}" --clobber
  gh release edit "$tag" --notes "$notes"
else
  gh release create "$tag" "${files[@]}" --title "$tag" --notes "$notes"
fi
