import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { LuArrowLeft, LuSearch } from "react-icons/lu";
import { back, canGoBack, goSection } from "../lib/router.js";
import { clockTime } from "../lib/format.js";
import { NAV_ITEMS } from "./Dock.jsx";
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
  const navRef = useRef(null);
  const day = now.toLocaleDateString([], { weekday: "long" });
  const date = now.toLocaleDateString([], { month: "long", day: "numeric" });
  const showBack = route.name !== "home" && canGoBack();

  useEffect(() => {
    const node = navRef.current;
    if (!node) return;
    gsap.to(node, {
      autoAlpha: compact ? 1 : 0,
      y: compact ? 0 : -6,
      duration: compact ? 0.4 : 0.2,
      ease: compact ? "expo.out" : "power2.out",
      overwrite: "auto",
    });
  }, [compact]);

  const active = route.name === "browse" ? `browse:${route.params.kind}` : route.name;

  return (
    <header className={`topbar${compact ? " topbar-compact" : ""}`}>
      <div className="topbar-left">
        {showBack ? (
          <button className="btn btn-glass btn-icon btn-sm" onClick={back} aria-label="Back" title="Back (Esc)">
            <LuArrowLeft />
          </button>
        ) : null}
        <div className="topbar-day">
          <span className="topbar-weekday">{day}</span>
          <span className="topbar-date"><i className="topbar-dot" />{date}</span>
        </div>
      </div>

      <nav ref={navRef} className="topbar-nav glass-flat" aria-label="Sections" style={{ visibility: "hidden" }}>
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
          <span className="avatar">{initials(profile?.name)}</span>
        </button>
      </div>
    </header>
  );
}
