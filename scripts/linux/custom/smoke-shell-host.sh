#!/usr/bin/env bash
# Smoke test for the Linux interface host (native/linux/shell_host.c), meant to run inside a
# virtual display: xvfb-run -a -s "-screen 0 1440x900x24" bash smoke-shell-host.sh <out-dir>
#
# 1. Standalone window with the preview backend (?mock): the page renders, the intro passes,
#    a profile opens Home, and a Blu-ray case on the trophy shelf lifts (3D transforms).
# 2. Embedded in a plain X11 window, the way the app hosts it: show, resize with the host, hide,
#    and the page's first requests arrive over the protocol.
set -uo pipefail

out="${1:-smoke-out}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
src="$root/composeApp/src/desktopMain/native/linux/shell_host.c"
page="file://$root/composeApp/src/desktopMain/resources/app-ui/index.html"
helper="${NUVIO_SHELL_HOST:-$out/nuvio-shell-host}"
fail=0

if [[ ! -x "$helper" ]]; then
    cc -std=gnu11 -O2 -Wall -Wno-deprecated-declarations \
        $(pkg-config --cflags webkit2gtk-4.1 gtk+-3.0 x11) "$src" -o "$helper" \
        $(pkg-config --libs webkit2gtk-4.1 gtk+-3.0 x11) || { echo "FAIL: helper did not compile"; exit 1; }
fi

cat > "$out/host.c" <<'HOST'
#include <X11/Xlib.h>
#include <stdio.h>
#include <unistd.h>
int main(void) {
    Display *d = XOpenDisplay(NULL);
    if (!d) return 1;
    int s = DefaultScreen(d);
    XSetWindowAttributes a; a.background_pixel = 0x802020; a.override_redirect = True;
    Window w = XCreateWindow(d, RootWindow(d, s), 40, 30, 1280, 800, 0, CopyFromParent, InputOutput,
                             CopyFromParent, CWBackPixel | CWOverrideRedirect, &a);
    XMapRaised(d, w); XFlush(d);
    printf("%lu\n", (unsigned long)w); fflush(stdout);
    for (;;) { XEvent e; XNextEvent(d, &e); }
}
HOST
cc "$out/host.c" -o "$out/host" -lX11 || { echo "FAIL: host window did not compile"; exit 1; }

shot() { import -window root "$out/$1.png" 2>/dev/null || xwd -root -silent | convert xwd:- "$out/$1.png"; }
export NUVIO_SHELL_TEST=1
(openbox >/dev/null 2>&1 &)
sleep 1

echo "== 1. standalone, preview backend"
mkfifo "$out/in1"
"$helper" 0 "$page?mock" "$out/data1" < "$out/in1" > "$out/out1.log" 2> "$out/err1.log" &
pid=$!
exec 3> "$out/in1"
# One script drives the page and reports each step, so slow machines only take longer.
driver="(async()=>{const say=m=>window.webkit.messageHandlers.shell.postMessage(m);const till=(f,t=30000)=>new Promise(r=>{const s=Date.now();const i=setInterval(()=>{let v=null;try{v=f()}catch(e){}if(v||Date.now()-s>t){clearInterval(i);r(v)}},250)});const nap=ms=>new Promise(r=>setTimeout(r,ms));const act='.screen-host:not(.is-parked) ';const gate=await till(()=>document.querySelector('.gate-profile.is-current, .gate-profile'));say('step:gate:'+!!gate);await nap(1500);gate&&gate.click();const lib=await till(()=>[...document.querySelectorAll('.topbar-nav button, .topbar-nav a')].find(b=>/Library/.test(b.textContent)));await nap(2500);say('step:home:'+!!lib);await nap(1500);lib&&lib.click();const tab=await till(()=>[...document.querySelectorAll(act+'button')].find(b=>/Trophies/.test(b.textContent)));tab&&tab.click();const slot=await till(()=>document.querySelector(act+'.bd-slot'));slot&&slot.scrollIntoView({block:'center'});await nap(1500);say('step:shelf:'+document.querySelectorAll('.bd-slot').length);await nap(1500);const third=document.querySelectorAll(act+'.bd-slot')[2];third&&third.click();await till(()=>document.querySelector('.bd-lift'),8000);await nap(2500);say('step:case:'+!!document.querySelector('.bd-lift'));await nap(1500);say('probe:'+[document.querySelectorAll('.bd-slot').length,!!document.querySelector('.bd-lift'),getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),CSS.supports('transform-style','preserve-3d'),CSS.supports('backdrop-filter','blur(2px)')||CSS.supports('-webkit-backdrop-filter','blur(2px)'),navigator.userAgent].join('|'));})()"
wait_for() { # <log> <pattern> <seconds>
    local n=0
    until grep -q "$2" "$1" 2>/dev/null; do
        sleep 0.5; n=$((n + 1))
        [[ $n -ge $(($3 * 2)) ]] && { echo "timeout waiting for $2"; return 1; }
    done
}
wait_for "$out/out1.log" '"event":"loaded"' 40
echo "E$driver" >&3
wait_for "$out/out1.log" '^Mstep:gate' 40 && shot 1-gate
wait_for "$out/out1.log" '^Mstep:home' 40 && shot 2-home
wait_for "$out/out1.log" '^Mstep:shelf' 60 && shot 3-shelf
wait_for "$out/out1.log" '^Mstep:case' 30 && shot 4-case
wait_for "$out/out1.log" '^Mprobe:' 15
grep '^Mstep:\|^Mprobe:' "$out/out1.log" | tee "$out/probe.txt"
kill -0 "$pid" 2>/dev/null || { echo "FAIL: standalone helper died"; fail=1; }
echo "Q" >&3
exec 3>&-
sleep 1; kill "$pid" 2>/dev/null
grep -q '"event":"created"' "$out/out1.log" || { echo "FAIL: no created event"; fail=1; }
grep -q '"event":"loaded"' "$out/out1.log" || { echo "FAIL: page did not load"; fail=1; }
grep -q '^Mprobe:[1-9]' "$out/probe.txt" || { echo "FAIL: trophy shelf did not render"; fail=1; }

echo "== 2. embedded in a host window, real protocol"
"$out/host" > "$out/host.xid" &
hostpid=$!
sleep 1
xid="$(head -1 "$out/host.xid")"
echo "host window $xid"
mkfifo "$out/in2"
"$helper" "$xid" "$page" "$out/data2" < "$out/in2" > "$out/out2.log" 2> "$out/err2.log" &
pid=$!
exec 4> "$out/in2"
sleep 2
shot 5-embedded-hidden
echo "V1" >&4; echo "F" >&4
wait_for "$out/out2.log" '"method"' 40
sleep 6
shot 6-embedded-shown
xdotool windowsize "$xid" 1000 640 2>/dev/null
echo "L" >&4
sleep 3
shot 7-embedded-resized
xwininfo -id "$xid" -children > "$out/tree.txt" 2>&1
echo "V0" >&4
sleep 2
shot 8-embedded-hidden-again
kill -0 "$pid" 2>/dev/null || { echo "FAIL: embedded helper died"; fail=1; }
echo "Q" >&4
exec 4>&-
sleep 1; kill "$pid" "$hostpid" 2>/dev/null
grep -q '"event":"loaded"' "$out/out2.log" || { echo "FAIL: embedded page did not load"; fail=1; }
grep -q '"method"' "$out/out2.log" || { echo "FAIL: the page's requests did not arrive"; fail=1; }
grep -q '1000x640' "$out/tree.txt" || { echo "FAIL: the interface did not follow the host's size"; cat "$out/tree.txt"; fail=1; }

echo "== logs"
head -c 600 "$out/out2.log"; echo
tail -n 15 "$out/err1.log" "$out/err2.log" 2>/dev/null
rm -f "$out/in1" "$out/in2" "$out/host" "$out/host.c"
rm -rf "$out/data1" "$out/data2"
[[ $fail -eq 0 ]] && echo "SMOKE OK" || echo "SMOKE FAILED"
exit $fail
