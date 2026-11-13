import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuArrowLeft, LuHouse, LuRotateCcw } from "react-icons/lu";
import { gsap } from "gsap";
import { call, notify, on } from "./bridge.js";
import { useTopic } from "./store.js";
import { AppProvider, useApp } from "./AppContext.jsx";
import { applyAppearance } from "./theme/appearance.js";
import { BEFORE_NAV, aliveEntries, back, forward, goSection, navigate, useRouter } from "./lib/router.js";
import { playScreenEntrance } from "./lib/motion.js";
import { recovered, reloadApp } from "./lib/session.js";
import { setArtProxy } from "./lib/artColor.js";
import { switchLook } from "./lib/look.js";
import { ScreenActiveContext } from "./lib/screen.js";
import { SHORTCUTS, focusSearch } from "./lib/nav.js";
import Shortcuts from "./components/Shortcuts.jsx";
import Background from "./components/Background.jsx";
import TopBar from "./components/TopBar.jsx";
import Toasts from "./components/Toasts.jsx";
import TrophyToast from "./components/TrophyToast.jsx";
import ProfileGate, { shouldShowGate } from "./components/ProfileGate.jsx";
import Home from "./screens/Home.jsx";
import Browse from "./screens/Browse.jsx";
import Search from "./screens/Search.jsx";
import Details from "./screens/Details.jsx";
import Person from "./screens/Person.jsx";
import Library from "./screens/Library.jsx";
import Settings from "./screens/Settings.jsx";
import Addons from "./screens/Addons.jsx";

// The preview (a plain browser with ?mock) can be driven from a test script.
const PREVIEW = typeof window !== "undefined" && /[?&]mock\b/.test(window.location.search);
if (PREVIEW) window.__nav = { navigate, goSection, back };

const SCREENS = { home: Home, browse: Browse, search: Search, details: Details, person: Person, library: Library, settings: Settings, addons: Addons };

const describe = error => String(error?.message || error || "Unknown error").slice(0, 400);

/**
 * Keeps a crash in one part of the interface from blanking the whole window: that part is
 * replaced by `fallback(error, retry)` (or by nothing) and the error goes to the app's log.
 * A new `resetKey` (the same screen opened with other params) clears it on its own.
 */
class Guard extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
    this.retry = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error, info) {
    const where = String(info?.componentStack || "").trim().split("\n")[0].trim();
    notify("app.log", { level: "error", message: `${this.props.name}: ${describe(error)}`, source: where });
    this.props.onError?.(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return this.props.fallback ? this.props.fallback(this.state.error, this.retry) : null;
  }
}

/** A screen that failed to draw: what happened, and two ways on. */
function ScreenError({ name, error, retry }) {
  return (
    <main className="screen screen-error">
      <div className="screen-error-body" role="alert">
        <h1 className="t-page">This page couldn't be shown</h1>
        <p>Something on it failed. Your library, progress and settings are not affected.</p>
        <p className="screen-error-detail" dir="auto">{describe(error)}</p>
        <div className="screen-error-actions">
          <button className="btn btn-primary" onClick={retry}><LuRotateCcw aria-hidden="true" /> Try again</button>
          {name === "home"
            ? <button className="btn btn-glass" onClick={reloadApp}>Reload Nuvio</button>
            : <button className="btn btn-glass" onClick={() => goSection("home")}><LuHouse aria-hidden="true" /> Go home</button>}
        </div>
      </div>
    </main>
  );
}

/** Stands in for a top bar or rail that failed to draw, so there is always a way back. */
function ChromeFallback() {
  return (
    <nav className="chrome-fallback" aria-label="Navigation">
      <button className="btn btn-glass btn-sm" onClick={back}><LuArrowLeft aria-hidden="true" /> Back</button>
      <button className="btn btn-glass btn-sm" onClick={() => goSection("home")}><LuHouse aria-hidden="true" /> Home</button>
    </nav>
  );
}

/** The whole interface failed (or never started): say so, and offer a fresh start. */
function BootError({ title, error }) {
  return (
    <div className="boot-error" role="alert">
      <h1 className="t-page">{title}</h1>
      <p className="t-meta">{describe(error)}</p>
      <button className="btn btn-primary" onClick={reloadApp}>Try again</button>
    </div>
  );
}

/**
 * One kept-alive screen. Parked screens stay mounted (state, scroll, decoded images) but are
 * taken out of flow, skipped by rendering and made inert; activating one restores its scroll
 * and glides it in.
 */
const ScreenLayer = memo(function ScreenLayer({ entry, active, nav }) {
  const ref = useRef(null);
  const shown = useRef(false);
  const rowScroll = useRef(new Map());
  const Component = SCREENS[entry.name] || Home;

  // Parking a screen drops its scrollers' offsets, so remember them just before leaving.
  useEffect(() => {
    if (!active) return undefined;
    const save = () => {
      const map = new Map();
      ref.current?.querySelectorAll(".row-track, [data-keep-scroll]").forEach(el => {
        if (el.scrollLeft || el.scrollTop) map.set(el, [el.scrollLeft, el.scrollTop]);
      });
      rowScroll.current = map;
    };
    window.addEventListener(BEFORE_NAV, save);
    return () => window.removeEventListener(BEFORE_NAV, save);
  }, [active]);

  useLayoutEffect(() => {
    if (!active) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;
    window.scrollTo(0, entry.scroll || 0);
    rowScroll.current.forEach(([left, top], el) => {
      if (!el.isConnected) return;
      el.scrollLeft = left;
      el.scrollTop = top;
    });
    playScreenEntrance(ref.current, nav);
    // Only on activation; nav is read for that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Parking/unparking must not re-render the whole screen; only what reads the active flag does.
  const content = useMemo(() => (
    <Guard name={`screen ${entry.name}`} resetKey={entry.params} fallback={(error, retry) => <ScreenError name={entry.name} error={error} retry={retry} />}>
      <Component params={entry.params} />
    </Guard>
  ), [Component, entry.name, entry.params]);

  return (
    <ScreenActiveContext.Provider value={active}>
      <div ref={ref} className={`screen-host${active ? "" : " is-parked"}`} inert={!active} aria-hidden={!active || undefined}>
        {content}
      </div>
    </ScreenActiveContext.Provider>
  );
});

function Screens() {
  const router = useRouter();
  const top = router.stack[router.stack.length - 1];
  const alive = useMemo(() => aliveEntries(router), [router]);
  return alive.map(entry => (
    <ScreenLayer key={entry.key} entry={entry} active={entry.key === top.key} nav={entry.key === top.key ? router.nav : null} />
  ));
}

const NO_FEATURED = [];

function Shell() {
  const router = useRouter();
  const top = router.stack[router.stack.length - 1];
  const { appearance, art, boot } = useApp();
  const [scrolled, setScrolled] = useState(false);
  const [gate, setGate] = useState(() => shouldShowGate(boot));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 300);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [keysOpen, setKeysOpen] = useState(false);
  useEffect(() => {
    const open = () => setKeysOpen(true);
    window.addEventListener(SHORTCUTS, open);
    return () => window.removeEventListener(SHORTCUTS, open);
  }, []);

  useEffect(() => {
    // Keys never leave a field the user is typing in, except Esc (which leaves the field).
    const isTyping = target => Boolean(target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable));
    const onKey = event => {
      // Something on top (the shelf's open case, a sheet) already took this key.
      if (event.defaultPrevented) return;
      const key = event.key || "";
      const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
      // A layer that is open (a sheet, the profile card, Who's watching?) owns the keys.
      const layer = document.querySelector("[data-modal-open]");
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && key.toLowerCase() === "k") {
        event.preventDefault();
        if (!layer) focusSearch();
        return;
      }
      // Alt+arrows edit nothing in a field, so they move through history from anywhere.
      if (event.altKey && !event.ctrlKey && !event.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) {
        if (layer) return;
        event.preventDefault();
        if (key === "ArrowLeft") back();
        else forward();
        return;
      }
      if (isTyping(event.target)) {
        if (key === "Escape" && !layer) event.target.blur();
        return;
      }
      if (layer) return;
      if (key === "/" && plain) { event.preventDefault(); focusSearch(); return; }
      if (key === "?" && plain) { event.preventDefault(); setKeysOpen(true); return; }
      if ((key === "Escape" || key === "Backspace") && plain && !event.shiftKey) back();
    };
    // Mouse side buttons: back and forward, like a browser.
    const onMouse = event => {
      if (event.button === 3) { event.preventDefault(); back(); }
      if (event.button === 4) { event.preventDefault(); forward(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    const offBack = on("nav.back", () => back());
    const offOpen = on("nav.open", data => {
      if (!data?.name) return;
      // Titles push onto the stack (back returns to where you were); sections switch tabs.
      if (data.name === "details") navigate("details", data.params || {});
      else goSection(data.name, data.params || {});
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
      offBack();
      offOpen();
    };
  }, []);

  // Ctrl+Shift+L: the other look, from anywhere.
  const { setAppearance, toast } = useApp();
  useEffect(() => { if (PREVIEW) window.__toast = toast; }, [toast]);
  // Said once, to someone still on Cinema: there is a second look now.
  useEffect(() => {
    if (gate) return undefined;
    let told = true;
    try { told = window.localStorage.getItem("nuvio.haze.told") === "1"; } catch { /* stay quiet */ }
    if (told || document.documentElement.dataset.layout === "haze") return undefined;
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem("nuvio.haze.told", "1"); } catch { /* a nicety */ }
      if (document.documentElement.dataset.layout === "haze") return;
      toast("New look: Haze. Switch back any time in Settings › Appearance.", {
        duration: 12000,
        action: { label: "Try it", run: () => switchLook("haze", layout => setAppearance({ layout })) },
      });
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [gate, toast, setAppearance]);
  useEffect(() => {
    const onKey = event => {
      if (!(event.ctrlKey && event.shiftKey && String(event.key || "").toLowerCase() === "l")) return;
      event.preventDefault();
      const next = document.documentElement.dataset.layout === "haze" ? "cinema" : "haze";
      switchLook(next, layout => setAppearance({ layout }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setAppearance]);

  const closeKeys = useCallback(() => setKeysOpen(false), []);
  const compact = top.name !== "home" || scrolled;
  const sceneArt = top.name === "details" ? art : null;

  // Each piece of the frame fails on its own: a broken backdrop or toast never takes the
  // screens with it, a broken bar leaves a way back, and a broken "Who's watching?" lets you in.
  return (
    <>
      <Guard name="backdrop"><Background appearance={appearance} featured={NO_FEATURED} art={sceneArt} scrolled={scrolled} /></Guard>
      <Guard name="chrome" fallback={() => <ChromeFallback />}>
        <TopBar route={top} stack={router.stack} profile={useApp().profile} compact={compact} />
      </Guard>
      <div className={gate ? "app-stage is-gated" : "app-stage"}>
        <Screens />
      </div>
      {gate ? <Guard name="profile gate" onError={() => setGate(false)}><ProfileGate onDone={() => setGate(false)} /></Guard> : null}
      <Guard name="toasts"><Toasts /></Guard>
      <Guard name="trophy toast"><TrophyToast /></Guard>
      {keysOpen ? <Guard name="shortcuts"><Shortcuts onClose={closeKeys} /></Guard> : null}
    </>
  );
}

// A picture that fails to load is never left as a broken-image icon. In order:
//   1. once more through Nuvio's local fetcher (browser headers, the unblock route), which gets
//      plain-http, hotlink-protected and blocked pictures;
//   2. the stand-in the card named (data-alt: an episode without a still shows the series' picture);
//   3. a drawn tile instead: the title in type for a poster, a quiet panel for a still, initials
//      for a person (see "Pictures that didn't load" in base.css).
// The stage is read from the address itself, so an <img> React reuses for another title starts over.
let imageProxy = null;
const initialsOf = name => String(name || "").split(/\s+/).map(word => word[0] || "").join("").slice(0, 2).toUpperCase();
const markBroken = img => {
  const holder = img.parentElement;
  img.dataset.broken = "1";
  if (!holder) return;
  const label = img.getAttribute("alt") || holder.closest("[aria-label]")?.getAttribute("aria-label") || "";
  holder.dataset.brokenName = holder.classList.contains("person")
    ? initialsOf(holder.querySelector(".person-name")?.textContent)
    : holder.classList.contains("card-face") && !holder.closest(".wide") ? label.replace(/^\d+\.\s/, "") : "";
};
if (typeof document !== "undefined") {
  document.addEventListener("error", event => {
    const img = event.target;
    if (img?.tagName !== "IMG") return;
    const src = img.getAttribute("src") || "";
    const viaProxy = Boolean(imageProxy) && src.startsWith(imageProxy);
    const original = viaProxy ? decodeURIComponent(src.slice(imageProxy.length)) : src;
    if (!viaProxy && imageProxy && /^https?:\/\//i.test(src) && !src.startsWith("http://127.0.0.1")) {
      img.src = imageProxy + encodeURIComponent(src);
      return;
    }
    const alt = img.dataset.alt || "";
    if (alt && alt !== original) { img.src = alt; return; }
    markBroken(img);
  }, true);
  document.addEventListener("load", event => {
    const img = event.target;
    if (img?.tagName !== "IMG" || !img.dataset.broken) return;
    delete img.dataset.broken;
    if (img.parentElement) delete img.parentElement.dataset.brokenName;
  }, true);
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    call("app.bootstrap").then(
      data => {
        if (!alive) return;
        applyAppearance(data.appearance);
        setBoot(data);
        call("net.get").then(net => { if (net?.port) { imageProxy = `http://127.0.0.1:${net.port}/img?k=${encodeURIComponent(net.key || "")}&u=`; setArtProxy(imageProxy); } }, () => {});
      },
      err => alive && setError(err),
    );
    const off = on("appearance", value => applyAppearance(value));
    return () => { alive = false; off(); };
  }, []);

  if (error) return <BootError title="Nuvio couldn't start its interface" error={error} />;
  return (
    <>
      {boot ? (
        <Guard name="interface" fallback={failure => <BootError title="Nuvio's interface stopped working" error={failure} />}>
          <AppProvider boot={boot}>
            <Shell />
          </AppProvider>
        </Guard>
      ) : <div className="boot" aria-busy="true" />}
      <Guard name="intro"><Intro ready={Boolean(boot)} /></Guard>
    </>
  );
}

/** Launch intro: the wordmark draws in over the gradient, then lifts away once data is ready. */
function Intro({ ready }) {
  const ref = useRef(null);
  // No intro over a page that only replaces one lost to a crash.
  const [done, setDone] = useState(() => recovered || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const shown = useRef(performance.now());
  const timeline = useRef(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const letters = node.querySelectorAll(".intro-letter");
    timeline.current = gsap.timeline()
      .fromTo(node.querySelector(".intro-glow"), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.1, ease: "expo.out" })
      .fromTo(letters, { yPercent: 110, opacity: 0, filter: "blur(10px)" },
        { yPercent: 0, opacity: 1, filter: "blur(0px)", duration: 0.8, ease: "expo.out", stagger: 0.06 }, 0.1)
      .fromTo(node.querySelector(".intro-line"), { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power3.inOut" }, 0.35);
    return () => timeline.current?.kill();
  }, []);

  useEffect(() => {
    if (!ready || done) return undefined;
    const wait = Math.max(0, 1300 - (performance.now() - shown.current));
    const timer = window.setTimeout(() => {
      // Hand off to the first screen: it rises into place as the wordmark lifts away.
      window.dispatchEvent(new Event("nuvio:intro-out"));
      gsap.to(ref.current, {
        opacity: 0, scale: 1.04, filter: "blur(8px)", duration: 0.7, ease: "power2.inOut",
        onComplete: () => setDone(true),
      });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [ready, done]);

  if (done) return null;
  return (
    <div ref={ref} className="intro" aria-hidden="true">
      <div className="intro-glow" />
      <div className="intro-word">
        {"NUVIO".split("").map((letter, i) => (
          <span key={i} className="intro-clip"><span className="intro-letter">{letter}</span></span>
        ))}
      </div>
      <div className="intro-line" />
    </div>
  );
}
