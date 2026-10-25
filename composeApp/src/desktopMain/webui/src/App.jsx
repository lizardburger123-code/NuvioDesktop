import { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from "react";
import { gsap } from "gsap";
import { call, on } from "./bridge.js";
import { useTopic } from "./store.js";
import { AppProvider, useApp } from "./AppContext.jsx";
import { applyAppearance } from "./theme/appearance.js";
import { back, currentDirection, goSection, useStack } from "./lib/router.js";
import Background from "./components/Background.jsx";
import TopBar from "./components/TopBar.jsx";
import Toasts from "./components/Toasts.jsx";
import Home from "./screens/Home.jsx";
import Browse from "./screens/Browse.jsx";
import Search from "./screens/Search.jsx";
import Details from "./screens/Details.jsx";
import Library from "./screens/Library.jsx";
import Settings from "./screens/Settings.jsx";

const SCREENS = { home: Home, browse: Browse, search: Search, details: Details, library: Library, settings: Settings };

function Screen({ entry }) {
  const ref = useRef(null);
  const Component = SCREENS[entry.name] || Home;
  useLayoutEffect(() => {
    window.scrollTo(0, entry.scroll || 0);
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const direction = currentDirection();
    const tween = gsap.fromTo(
      node,
      { opacity: 0, x: direction * 28, y: direction === 0 ? 10 : 0 },
      { opacity: 1, x: 0, y: 0, duration: 0.5, ease: "expo.out", clearProps: "transform,opacity" },
    );
    return () => tween.kill();
  }, [entry.key]);
  return (
    <div ref={ref} className="screen-host">
      <Component params={entry.params} />
    </div>
  );
}

function Shell() {
  const stack = useStack();
  const top = stack[stack.length - 1];
  const { appearance, art } = useApp();
  const home = useTopic("home", { hero: [] });
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 300);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const isTyping = target => target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    const onKey = event => {
      if ((event.ctrlKey && event.key.toLowerCase() === "k") || (event.key === "/" && !isTyping(event.target))) {
        event.preventDefault();
        goSection("search");
        return;
      }
      if (event.key === "Escape" && !document.querySelector("[data-modal-open]")) {
        if (isTyping(event.target)) event.target.blur();
        else back();
      }
      if (event.key === "Backspace" && !isTyping(event.target)) back();
    };
    const onMouse = event => { if (event.button === 3) { event.preventDefault(); back(); } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    const offBack = on("nav.back", () => back());
    const offOpen = on("nav.open", data => data?.name && goSection(data.name, data.params || {}));
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
      offBack();
      offOpen();
    };
  }, []);

  const compact = top.name !== "home" || scrolled;
  const sceneArt = top.name === "details" ? art : null;

  return (
    <>
      <Background appearance={appearance} featured={home.hero} art={sceneArt} scrolled={scrolled && top.name === "home"} />
      <TopBar route={top} profile={useApp().profile} compact={compact} />
      <Screen key={top.key} entry={top} />
      <Toasts />
    </>
  );
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
      },
      err => alive && setError(err),
    );
    const off = on("appearance", value => applyAppearance(value));
    return () => { alive = false; off(); };
  }, []);

  if (error) {
    return (
      <div className="boot-error">
        <h1 className="t-page">Nuvio couldn't start its interface</h1>
        <p className="t-meta">{String(error.message || error)}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }
  if (!boot) return <div className="boot" aria-busy="true" />;
  return (
    <AppProvider boot={boot}>
      <Shell />
    </AppProvider>
  );
}
