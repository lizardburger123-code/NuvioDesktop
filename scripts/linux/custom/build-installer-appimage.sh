#!/usr/bin/env bash
# Builds the Linux setup file: one AppImage that installs Nuvio when it is opened (see
# installer-apprun.sh for what it does on the computer). The app inside is the one from the
# Ubuntu .deb, unchanged: its bundle carries its own Java runtime and its native parts link
# against libraries every distribution ships under the same names.
#
# Usage: build-installer-appimage.sh <path-to.deb> <version> <out-dir>
# appimagetool is taken from $APPIMAGETOOL, or downloaded (the same pinned version and checksum
# as the upstream release workflow).
set -euo pipefail

deb="$(realpath "$1")"
version="$2"
out="$(mkdir -p "$3" && cd "$3" && pwd)"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

tool="${APPIMAGETOOL:-}"
if [[ -z "$tool" ]]; then
    tool_version="1.9.1"
    tool_sha256="ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"
    tool="$work/appimagetool-x86_64.AppImage"
    curl -fsSL -o "$tool" "https://github.com/AppImage/appimagetool/releases/download/${tool_version}/appimagetool-x86_64.AppImage"
    actual="$(sha256sum "$tool" | awk '{ print $1 }')"
    if [[ "$actual" != "$tool_sha256" ]]; then
        echo "appimagetool checksum mismatch: expected $tool_sha256, got $actual" >&2
        exit 1
    fi
    chmod +x "$tool"
fi

dpkg-deb -x "$deb" "$work/deb"
test -x "$work/deb/opt/nuvio/bin/Nuvio"
test -f "$work/deb/opt/nuvio/lib/Nuvio.png"

app_dir="$work/Nuvio.AppDir"
mkdir -p "$app_dir"
cp -a "$work/deb/opt/nuvio" "$app_dir/app"
# jpackage's own menu entry, which the .deb's scripts would have registered: the setup writes its own.
rm -f "$app_dir"/app/lib/*.desktop
printf '%s\n' "$version" > "$app_dir/VERSION"
install -m 755 "$root/scripts/linux/custom/installer-apprun.sh" "$app_dir/AppRun"

# What the file itself looks like on a desktop before it is opened.
cat > "$app_dir/nuvio-setup.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Nuvio Setup
Comment=Installs Nuvio Media Player
Exec=AppRun
Icon=nuvio-setup
Terminal=false
Categories=AudioVideo;
EOF
cp "$app_dir/app/lib/Nuvio.png" "$app_dir/nuvio-setup.png"
ln -sf nuvio-setup.png "$app_dir/.DirIcon"

output="$out/Nuvio-Setup-Linux-x86_64-${version}.AppImage"
ARCH=x86_64 "$tool" --appimage-extract-and-run --no-appstream "$app_dir" "$output"
test -f "$output"
chmod +x "$output"
ls -la "$output"
printf 'Built the setup file: %s\n' "$output"
