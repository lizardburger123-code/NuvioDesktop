import { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from "react";
import { gsap } from "gsap";
import { call, on } from "./bridge.js";
import { useTopic } from "./store.js";
import { AppProvider, useApp } from "./AppContext.jsx";
import { applyAppearance } from "./theme/appearance.js";
import { back, goSection, useStack } from "./lib/router.js";
import Background from "./components/Background.jsx";
import TopBar from "./components/TopBar.jsx";
import Toasts from "./components/Toasts.jsx";
import ClickSpark from "./reactbits/ClickSpark/ClickSpark.jsx";
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
  }, [entry.key]);
  return (
    <div ref={ref} className="screen-host">
      <Component params={entry.params} />
    </div>
  );
}

const appearanceSpark = appearance => (appearance?.colors?.length ? ["#ffffff", ...appearance.colors] : "#ffffff");

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
      <ClickSpark sparkColor={appearanceSpark(appearance)} sparkCount={10} sparkRadius={26} sparkSize={12} duration={520} shape="streak" glow={0.6}>
        <Screen key={top.key} entry={top} />
      </ClickSpark>
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
  return (
    <>
      {boot ? (
        <AppProvider boot={boot}>
          <Shell />
        </AppProvider>
      ) : <div className="boot" aria-busy="true" />}
      <Intro ready={Boolean(boot)} />
    </>
  );
}

/** Launch intro: the wordmark draws in over the gradient, then lifts away once data is ready. */
function Intro({ ready }) {
  const ref = useRef(null);
  const [done, setDone] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
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
