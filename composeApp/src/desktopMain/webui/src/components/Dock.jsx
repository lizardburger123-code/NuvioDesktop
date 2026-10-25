import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { LuBookmark, LuFilm, LuHouse, LuLibrary, LuSettings, LuSparkles, LuTv } from "react-icons/lu";
import { goSection } from "../lib/router.js";
import "./Dock.css";

export const NAV_ITEMS = [
  { route: "home", label: "Home", icon: LuHouse, inTopBar: true },
  { route: "browse", kind: "movie", label: "Movies", icon: LuFilm, inTopBar: true },
  { route: "browse", kind: "series", label: "Series", icon: LuTv, inTopBar: true },
  { route: "browse", kind: "anime", label: "Anime", icon: LuSparkles, inTopBar: true },
  { route: "library", label: "Library", icon: LuLibrary, inTopBar: true },
  { route: "library", tab: "later", label: "Watch later", icon: LuBookmark },
  { route: "settings", label: "Settings", icon: LuSettings, inTopBar: true },
];

/** The row of round section buttons on Home (the "app icons" of the dashboard). */
export default function Dock({ counts = {} }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const items = ref.current?.querySelectorAll(".dock-item");
    if (!items?.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const tween = gsap.from(items, { y: 14, autoAlpha: 0, duration: 0.6, ease: "expo.out", stagger: 0.04, delay: 0.12, clearProps: "transform,opacity,visibility" });
    return () => tween.kill();
  }, []);

  return (
    <nav ref={ref} className="dock" aria-label="Sections">
      {NAV_ITEMS.map(item => {
        const Icon = item.icon;
        const count = item.tab === "later" ? counts.later : undefined;
        return (
          <button
            key={`${item.route}:${item.kind || item.tab || ""}`}
            className="dock-item"
            aria-current={item.route === "home" ? "page" : undefined}
            onClick={() => goSection(item.route, item.kind ? { kind: item.kind } : item.tab ? { tab: item.tab } : {})}
          >
            <span className="dock-icon">
              <Icon />
              {count ? <span className="dock-badge num">{count}</span> : null}
            </span>
            <span className="dock-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
