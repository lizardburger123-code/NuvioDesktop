#!/usr/bin/env bash
# Builds a pacman package for Arch Linux from the Ubuntu .deb (the usual "-bin" repack: the app
# bundle carries its own Java runtime, and its native parts link against libraries Arch ships
# under the same names), then proves it inside a real Arch container: installs it with its
# dependencies, checks every native library resolves, and runs the interface host on a virtual
# display.
#
# With the setup file (the AppImage that installs the app) as a fourth argument, the container
# also tries that: it starts without the app's system parts, so this is where the setup's check
# for them, its words about them and its install of them are proved.
#
# Usage: build-arch-package.sh <path-to.deb> <version> <out-dir> [<setup.AppImage>]
set -euo pipefail

deb="$(realpath "$1")"
version="$2"
out="$(mkdir -p "$3" && cd "$3" && pwd)"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
work="$(mktemp -d)"
trap 'sudo rm -rf "$work"' EXIT

cp "$deb" "$work/nuvio.deb"
if [[ -n "${4:-}" && -f "${4:-}" ]]; then
    cp "$4" "$work/nuvio-setup.AppImage"
    chmod a+rx "$work/nuvio-setup.AppImage"
fi
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
setup_status=0
if [ -f /work/nuvio-setup.AppImage ]; then
    echo "== the setup file, on a system without the app's system parts"
    # No FUSE in a container: the file unpacks itself to run.
    setup() { su builder -c "APPIMAGE_EXTRACT_AND_RUN=1 /work/nuvio-setup.AppImage $*"; }
    rc=0; setup --check > /tmp/setup-check.txt 2>&1 || rc=$?
    cat /tmp/setup-check.txt
    if [ "$rc" != 3 ] || ! grep -q "sudo pacman -S --needed .*mpv.*webkit2gtk-4.1" /tmp/setup-check.txt; then
        echo "FAIL: the setup file did not name the missing parts and the command for them (exit $rc)"; setup_status=1
    fi
    # Installing works without them; the setup says what is still needed and how to get it.
    rc=0; setup --install --yes --no-launch > /tmp/setup-install.txt 2>&1 || rc=$?
    cat /tmp/setup-install.txt
    if [ ! -x /home/builder/.local/share/nuvio/bin/Nuvio ] || [ "$rc" = 0 ] || ! grep -q "sudo pacman -S --needed" /tmp/setup-install.txt; then
        echo "FAIL: the setup file should install the app and say which parts are still needed (exit $rc)"; setup_status=1
    fi
    # As the administrator it installs exactly those parts itself.
    rc=0; APPIMAGE_EXTRACT_AND_RUN=1 /work/nuvio-setup.AppImage --install-deps || rc=$?
    if [ "$rc" != 0 ]; then echo "FAIL: the setup file could not install the missing parts (exit $rc)"; setup_status=1; fi
    rc=0; setup --check || rc=$?
    if [ "$rc" != 0 ]; then echo "FAIL: parts are still reported missing after installing them (exit $rc)"; setup_status=1; fi
    if LD_LIBRARY_PATH=/home/builder/.local/share/nuvio/lib/runtime/lib:/home/builder/.local/share/nuvio/lib/runtime/lib/server ldd /home/builder/.local/share/nuvio/lib/runtime/lib/libawt_xawt.so | grep "not found"; then
        echo "FAIL: the app the setup file installed has missing libraries"; setup_status=1
    fi
    setup --uninstall --yes || setup_status=1
    if [ -e /home/builder/.local/share/nuvio ]; then echo "FAIL: removing left the app behind"; setup_status=1; fi
    if [ "$setup_status" = 0 ]; then echo "ok: setup file"; fi
fi
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
echo "== the app itself starts on Arch (reported, not a gate: a container is not a desktop)"
cat > /tmp/run-app.sh <<'APP'
export HOME="$(mktemp -d)"
(openbox >/dev/null 2>&1 &)
sleep 1
/opt/nuvio/bin/Nuvio > /work/smoke-arch/app.log 2>&1 &
pid=$!
sleep 45
alive=0; kill -0 "$pid" 2>/dev/null && alive=1
width="$(xwininfo -root -tree | grep -E '"Nuvio": \("com-nuvio-app-MainKt"' | sed -E 's/.*\)[[:space:]]+([0-9]+)x[0-9]+.*/\1/' | head -n 1)"
kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null
echo "ARCH APP: running after 45s: $alive, window width ${width:-none}"
APP
xvfb-run -a -s "-screen 0 1440x900x24" dbus-run-session -- bash /tmp/run-app.sh || true
grep -iE "exception|error|UnsatisfiedLink" /work/smoke-arch/app.log | head -n 8 || true
chmod -R a+rwX /work/smoke-arch 2>/dev/null || true
[ "$setup_status" = 0 ] || status=1
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
