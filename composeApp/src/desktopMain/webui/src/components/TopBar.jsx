import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuArrowLeft, LuSearch } from "react-icons/lu";
import { activeSection, back, canGoBack, goSection } from "../lib/router.js";
import { reduceMotion, spring, stopAnimations } from "../lib/motion.js";
import { clockTime } from "../lib/format.js";
import { NAV_ITEMS } from "../lib/nav.js";
import GradientText from "../reactbits/GradientText/GradientText.jsx";
import { useApp } from "../AppContext.jsx";
import ProfileCard, { Avatar } from "./ProfileCard.jsx";
import "./TopBar.css";

export { initials } from "./ProfileCard.jsx";

/** Open the profile card from anywhere (Settings uses it): detail { view: "picture" }. */
export const PROFILE_CARD = "nuvio:profile-card";

const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 15000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

const SECTIONS = NAV_ITEMS.filter(item => item.inTopBar).map(item => ({
  ...item,
  id: item.kind ? `browse:${item.kind}` : item.route,
}));

// Two springs: the edge that leads the move is quick, the trailing edge follows a little later,
// so the pill stretches toward its target and settles like liquid.
const LEAD = spring({ stiffness: 420, damping: 32 });
const TRAIL = spring({ stiffness: 230, damping: 25 });

/**
 * Section switcher. The white pill is a clipped copy of the labels in dark ink, so the label
 * colour changes exactly where the pill edge passes instead of flipping on click.
 */
function SectionNav({ active }) {
  const navRef = useRef(null);
  const pillRef = useRef(null);
  const placed = useRef(false);

  const edgesFor = id => {
    const nav = navRef.current;
    const button = id ? nav.querySelector(`[data-id="${id}"]`) : null;
    if (!button) return null;
    return { left: button.offsetLeft, right: nav.clientWidth - button.offsetLeft - button.offsetWidth };
  };

  // Where the pill is right now, mid-animation included (read from its live clip-path).
  const currentEdges = () => {
    const style = getComputedStyle(pillRef.current);
    const live = /inset\(\s*[\d.]+px\s+([\d.-]+)px\s+[\d.]+px\s+([\d.-]+)px/.exec(style.clipPath || "");
    if (live) return { left: parseFloat(live[2]) || 0, right: parseFloat(live[1]) || 0 };
    return {
      left: parseFloat(style.getPropertyValue("--pill-l")) || 0,
      right: parseFloat(style.getPropertyValue("--pill-r")) || 0,
    };
  };

  const place = (edges, animate) => {
    const pill = pillRef.current;
    if (!pill || !edges) return;
    const from = currentEdges();
    stopAnimations(pill);
    pill.style.setProperty("--pill-l", `${edges.left}px`);
    pill.style.setProperty("--pill-r", `${edges.right}px`);
    if (!animate || reduceMotion()) return;
    const movingRight = edges.left > from.left;
    const leftSpring = movingRight ? TRAIL : LEAD;
    const rightSpring = movingRight ? LEAD : TRAIL;
    // One clip-path animation sampled from both springs: it runs as a single compositor-friendly
    // track instead of two custom-property animations re-styling every frame (that stuttered
    // while Home was coming back in behind it).
    const duration = Math.max(leftSpring.duration, rightSpring.duration);
    const steps = 36;
    const frames = [];
    for (let i = 0; i <= steps; i += 1) {
      const ms = (i / steps) * duration;
      const l = from.left + (edges.left - from.left) * leftSpring.at(ms);
      const r = from.right + (edges.right - from.right) * rightSpring.at(ms);
      frames.push({ clipPath: `inset(4px ${r.toFixed(2)}px 4px ${l.toFixed(2)}px round 999px)` });
    }
    pill.animate(frames, { duration, easing: "linear" });
  };

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const target = edgesFor(active);
    if (!target) {
      // No section (search): the pill shrinks into its own centre.
      const now = currentEdges();
      const centre = (now.left + (nav.clientWidth - now.right)) / 2;
      place({ left: centre, right: nav.clientWidth - centre }, placed.current);
      return;
    }
    const now = currentEdges();
    const collapsed = nav.clientWidth - now.left - now.right < 4;
    if (placed.current && collapsed) {
      // Grow out of the target's centre instead of sweeping across from nowhere.
      const centre = target.left + (nav.clientWidth - target.left - target.right) / 2;
      pillRef.current.style.setProperty("--pill-l", `${centre}px`);
      pillRef.current.style.setProperty("--pill-r", `${nav.clientWidth - centre}px`);
    }
    place(target, placed.current);
    placed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Fonts loading or the window resizing move the labels: re-seat the pill without motion.
  // (Observed once; the observer's first callback is ignored so it can't cancel a slide.)
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    let width = nav.clientWidth;
    const reseat = () => {
      if (pillRef.current?.getAnimations().length) return;
      const edges = edgesFor(activeRef.current);
      if (edges) place(edges, false);
    };
    const observer = new ResizeObserver(() => {
      if (nav.clientWidth === width) return;
      width = nav.clientWidth;
      reseat();
    });
    observer.observe(nav);
    document.fonts?.ready.then(reseat);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <nav ref={navRef} className="topbar-nav" aria-label="Sections">
      <div className="topbar-nav-track">
        {SECTIONS.map(item => (
          <button
            key={item.id}
            data-id={item.id}
            className="topbar-nav-item"
            aria-current={active === item.id ? "page" : undefined}
            onClick={() => goSection(item.route, item.kind ? { kind: item.kind } : {})}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div ref={pillRef} className="topbar-nav-pill" aria-hidden="true">
        <div className="topbar-nav-track">
          {SECTIONS.map(item => <span key={item.id} className="topbar-nav-item">{item.label}</span>)}
        </div>
      </div>
    </nav>
  );
}

export default function TopBar({ route, stack, profile, compact }) {
  const now = useNow();
  const { appearance } = useApp();
  const colors = appearance?.colors?.length ? ["#ffffff", ...appearance.colors, "#ffffff"] : ["#ffffff", "#b497cf", "#ffffff"];
  const day = now.toLocaleDateString([], { weekday: "long" });
  const date = now.toLocaleDateString([], { month: "long", day: "numeric" });
  const showBack = canGoBack();
  const section = activeSection(stack);
  const profileRef = useRef(null);
  const [card, setCard] = useState(null);
  const [closeRequest, setCloseRequest] = useState(0);
  const toggleCard = () => (card ? setCloseRequest(n => n + 1) : setCard({ view: "main" }));

  useEffect(() => {
    const open = event => setCard({ view: event.detail?.view || "main" });
    window.addEventListener(PROFILE_CARD, open);
    return () => window.removeEventListener(PROFILE_CARD, open);
  }, []);

  return (
    <header className={`topbar${compact ? " topbar-compact" : ""}${showBack ? " has-back" : ""}`}>
      <div className="topbar-left">
        <button className="btn btn-glass btn-icon btn-sm topbar-back" onClick={back} aria-label="Back" title="Back (Esc)" tabIndex={showBack ? 0 : -1} aria-hidden={!showBack || undefined}>
          <LuArrowLeft />
        </button>
        <div className="topbar-day">
          <GradientText className="topbar-weekday" colors={colors} animationSpeed={14}>{day}</GradientText>
          <span className="topbar-date"><i className="topbar-dot" />{date}</span>
        </div>
      </div>

      <SectionNav active={section} />

      <div className="topbar-right">
        <button
          className={`btn btn-glass btn-icon btn-sm topbar-search${section === "search" ? " is-on" : ""}`}
          aria-label="Search"
          title="Search (Ctrl+K)"
          onClick={() => goSection("search")}
        >
          <LuSearch />
        </button>
        <span className="topbar-clock num">{clockTime(now)}</span>
        <button
          ref={profileRef}
          className={`topbar-profile${card ? " is-open" : ""}`}
          onClick={toggleCard}
          aria-haspopup="dialog"
          aria-expanded={Boolean(card)}
          title="Profile"
        >
          <span className="topbar-hi" dir="auto">Hi, {String(profile?.name || "there").split(" ")[0]}</span>
          <Avatar profile={profile} />
        </button>
      </div>
      {card ? (
        <ProfileCard
          key={card.view}
          anchorRef={profileRef}
          initialView={card.view}
          closeRequest={closeRequest}
          onClose={() => { setCard(null); setCloseRequest(0); }}
        />
      ) : null}
    </header>
  );
}
