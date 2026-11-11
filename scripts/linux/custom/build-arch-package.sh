#!/usr/bin/env bash
# Builds a pacman package for Arch Linux from the Ubuntu .deb (the usual "-bin" repack: the app
# bundle carries its own Java runtime, and its native parts link against libraries Arch ships
# under the same names), then proves it inside a real Arch container: installs it with its
# dependencies, checks every native library resolves, and runs the interface host on a virtual
# display.
#
# Usage: build-arch-package.sh <path-to.deb> <version> <out-dir>
set -euo pipefail

deb="$(realpath "$1")"
version="$2"
out="$(mkdir -p "$3" && cd "$3" && pwd)"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
work="$(mktemp -d)"
trap 'sudo rm -rf "$work"' EXIT

cp "$deb" "$work/nuvio.deb"
cp "$root/scripts/linux/custom/smoke-shell-host.sh" "$work/smoke-shell-host.sh"
mkdir -p "$work/app-ui"
cp -r "$root/composeApp/src/desktopMain/resources/app-ui/." "$work/app-ui/"

cat > "$work/PKGBUILD" <<PKG
pkgname=nuvio-fork-bin
pkgver=${version}
pkgrel=1
pkgdesc="Nuvio media player (community fork build)"
arch=('x86_64')
url="https://nuvio.tv"
license=('custom')
depends=('mpv' 'webkit2gtk-4.1' 'gtk3' 'libxcomposite' 'libxext' 'libx11' 'gst-plugins-good' 'gst-libav' 'glib-networking' 'xdg-utils' 'dbus' 'hicolor-icon-theme')
provides=('nuvio')
conflicts=('nuvio')
options=('!strip' '!debug')
source=('nuvio.deb')
noextract=('nuvio.deb')
sha256sums=('SKIP')

package() {
    cd "\$srcdir"
    bsdtar -xf nuvio.deb
    bsdtar -xf data.tar.* -C "\$pkgdir"
    # Debian-only bits.
    rm -rf "\$pkgdir/usr/share/doc" "\$pkgdir/usr/share/lintian"
    install -d "\$pkgdir/usr/bin"
    ln -s /opt/nuvio/bin/Nuvio "\$pkgdir/usr/bin/nuvio"
    if [ -f "\$pkgdir/opt/nuvio/lib/Nuvio.png" ]; then
        install -Dm644 "\$pkgdir/opt/nuvio/lib/Nuvio.png" "\$pkgdir/usr/share/icons/hicolor/512x512/apps/nuvio.png"
    fi
}
PKG

cat > "$work/in-arch.sh" <<'ARCH'
#!/usr/bin/env bash
set -euo pipefail
cd /work
pacman -Syu --noconfirm --needed base-devel libarchive >/dev/null
useradd -m builder
chown -R builder /work
su builder -c "cd /work && makepkg --nodeps --noconfirm"
pkg="$(ls /work/*.pkg.tar.zst | head -1)"
echo "== package"; pacman -Qip "$pkg" | sed -n 1,14p
echo "== install with dependencies"
pacman -U --noconfirm "$pkg" >/dev/null
test -x /opt/nuvio/bin/Nuvio
echo "== native libraries resolve on Arch"
mkdir -p /tmp/native && cd /tmp/native
for jar in /opt/nuvio/lib/app/*.jar; do
    bsdtar -xf "$jar" 'native/linux/*' 2>/dev/null || true
done
ls -la native/linux
status=0
chmod +x native/linux/*
for lib in native/linux/libplayer_bridge.so native/linux/nuvio-shell-host native/linux/libnuvio_engine.so; do
    test -f "$lib" || { echo "FAIL: $lib is not in the package"; status=1; continue; }
    if ldd "$lib" | grep "not found"; then echo "FAIL: $lib has missing libraries"; status=1; else echo "ok: $lib"; fi
done
# The bundled Java runtime finds its own libraries beside itself; only system ones can be missing.
if LD_LIBRARY_PATH=/opt/nuvio/lib/runtime/lib:/opt/nuvio/lib/runtime/lib/server ldd /opt/nuvio/lib/runtime/lib/libawt_xawt.so | grep "not found"; then
    echo "FAIL: the bundled Java runtime has missing libraries"; status=1
else
    echo "ok: bundled Java runtime"
fi
echo "== interface host on a virtual display"
pacman -S --noconfirm --needed xorg-server-xvfb xorg-xauth openbox imagemagick xdotool xorg-xwininfo xorg-xwd mesa ttf-dejavu >/dev/null
chmod +x native/linux/nuvio-shell-host
mkdir -p /work/repo/composeApp/src/desktopMain/resources /work/repo/scripts/linux/custom
cp -r /work/app-ui /work/repo/composeApp/src/desktopMain/resources/app-ui
mkdir -p /work/repo/composeApp/src/desktopMain/native/linux && touch /work/repo/composeApp/src/desktopMain/native/linux/shell_host.c
cp /work/smoke-shell-host.sh /work/repo/scripts/linux/custom/
export NUVIO_SHELL_HOST=/tmp/native/native/linux/nuvio-shell-host
# WebKit's sandbox needs user namespaces a container may not give.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
xvfb-run -a -s "-screen 0 1440x900x24" bash /work/repo/scripts/linux/custom/smoke-shell-host.sh /work/smoke-arch || status=1
chmod -R a+rwX /work/smoke-arch 2>/dev/null || true
exit $status
ARCH
chmod +x "$work/in-arch.sh"

set +e
docker run --rm -v "$work:/work" archlinux:base-devel bash /work/in-arch.sh
status=$?
set -e
# The container's build user owns the work folder now.
sudo chown -R "$(id -u):$(id -g)" "$work"
cp "$work"/*.pkg.tar.zst "$out/"
mkdir -p "$out/smoke-arch"
cp -r "$work/smoke-arch/." "$out/smoke-arch/" 2>/dev/null || true
ls -la "$out"
exit $status
