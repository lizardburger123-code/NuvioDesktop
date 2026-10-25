import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { LuArrowLeft, LuSearch } from "react-icons/lu";
import { back, canGoBack, goSection } from "../lib/router.js";
import { clockTime } from "../lib/format.js";
import { NAV_ITEMS } from "./Dock.jsx";
import GradientText from "../reactbits/GradientText/GradientText.jsx";
import { useApp } from "../AppContext.jsx";
import "./TopBar.css";

const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 15000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

export const initials = name => String(name || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();

export default function TopBar({ route, profile, compact }) {
  const now = useNow();
  const { appearance } = useApp();
  const colors = appearance?.colors?.length ? ["#ffffff", ...appearance.colors, "#ffffff"] : ["#ffffff", "#b497cf", "#ffffff"];
  const navRef = useRef(null);
  const day = now.toLocaleDateString([], { weekday: "long" });
  const date = now.toLocaleDateString([], { month: "long", day: "numeric" });
  const showBack = route.name !== "home" && canGoBack();

  const active = route.name === "browse" ? `browse:${route.params.kind}` : route.name;
  const indRef = useRef(null);
  const placed = useRef(false);

  // The white pill slides between sections instead of jumping.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const ind = indRef.current;
    if (!nav || !ind) return;
    const target = nav.querySelector('[aria-current="page"]');
    if (!target) {
      gsap.to(ind, { autoAlpha: 0, scale: 0.9, duration: 0.25, ease: "power2.out", overwrite: "auto" });
      return;
    }
    const vars = { x: target.offsetLeft, width: target.offsetWidth, autoAlpha: 1, scale: 1 };
    if (!placed.current) {
      gsap.set(ind, vars);
      placed.current = true;
    } else {
      gsap.to(ind, { ...vars, duration: 0.55, ease: "elastic.out(1, 0.75)", overwrite: "auto" });
    }
  }, [active]);

  return (
    <header className={`topbar${compact ? " topbar-compact" : ""}`}>
      <div className="topbar-left">
        {showBack ? (
          <button className="btn btn-glass btn-icon btn-sm" onClick={back} aria-label="Back" title="Back (Esc)">
            <LuArrowLeft />
          </button>
        ) : null}
        <div className="topbar-day">
          <GradientText className="topbar-weekday" colors={colors} animationSpeed={10} glow={0.35}>{day}</GradientText>
          <span className="topbar-date"><i className="topbar-dot" />{date}</span>
        </div>
      </div>

      <nav ref={navRef} className="topbar-nav glass-flat" aria-label="Sections">
        <span ref={indRef} className="topbar-nav-ind" aria-hidden="true" />
        {NAV_ITEMS.filter(item => item.inTopBar).map(item => {
          const id = item.kind ? `browse:${item.kind}` : item.route;
          return (
            <button
              key={id}
              className="topbar-nav-item"
              aria-current={active === id ? "page" : undefined}
              onClick={() => goSection(item.route, item.kind ? { kind: item.kind } : {})}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="topbar-right">
        <button className="btn btn-glass btn-icon btn-sm topbar-search" aria-label="Search" title="Search (Ctrl+K)" onClick={() => goSection("search")}>
          <LuSearch />
        </button>
        <span className="topbar-clock num">{clockTime(now)}</span>
        <button className="topbar-profile" onClick={() => goSection("settings", { section: "profile" })} title="Profile">
          <span className="topbar-hi">Hi, {String(profile?.name || "there").split(" ")[0]}</span>
          <Avatar profile={profile} />
        </button>
      </div>
    </header>
  );
}

function Avatar({ profile }) {
  const [failed, setFailed] = useState(false);
  if (profile?.avatar && !failed) {
    return <img className="avatar avatar-img" src={profile.avatar} alt="" onError={() => setFailed(true)} />;
  }
  return <span className="avatar" style={profile?.color ? { background: profile.color } : undefined}>{initials(profile?.name)}</span>;
}
