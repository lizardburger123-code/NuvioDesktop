import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowLeft, LuBookmark, LuDownload, LuFilm, LuFlame, LuHouse, LuPuzzle, LuSearch, LuSettings, LuSparkles, LuSwatchBook, LuTrophy, LuTv,
} from "react-icons/lu";
import { back, canGoBack, goSection, sectionId } from "../lib/router.js";
import { useTopic } from "../store.js";
import { level, streaks } from "../lib/trophies.js";
import { NAV_ITEMS, focusSearch } from "../lib/nav.js";
import { switchLook } from "../lib/look.js";
import { useApp } from "../AppContext.jsx";
import ProfileCard, { Avatar } from "../components/ProfileCard.jsx";

// Same event the Cinema bar listens for (Settings opens the profile card with it).
const PROFILE_CARD = "nuvio:profile-card";
import "./Chrome.css";

const TABS = NAV_ITEMS.filter(item => item.inTopBar).map(item => ({ ...item, id: item.kind ? `browse:${item.kind}` : item.route }));

/** Everything the app has, one icon each. `match` tells whether the place on screen is this one. */
const RAIL = [
  { id: "home", label: "Home", icon: LuHouse, go: () => goSection("home"), match: (id) => id === "home" },
  { id: "search", label: "Search", hint: "Ctrl K", icon: LuSearch, go: focusSearch, match: id => id === "search" },
  { id: "movies", label: "Movies", icon: LuFilm, go: () => goSection("browse", { kind: "movie" }), match: id => id === "browse:movie" },
  { id: "series", label: "Series", icon: LuTv, go: () => goSection("browse", { kind: "series" }), match: id => id === "browse:series" },
  { id: "anime", label: "Anime", icon: LuSparkles, go: () => goSection("browse", { kind: "anime" }), match: id => id === "browse:anime" },
  { gap: true },
  { id: "list", label: "My list", icon: LuBookmark, go: () => goSection("library", { tab: "later" }), match: (id, p) => id === "library" && !["completed", "downloads"].includes(p.tab) },
  { id: "trophies", label: "Trophies", icon: LuTrophy, go: () => goSection("library", { tab: "completed" }), match: (id, p) => id === "library" && p.tab === "completed" },
  { id: "downloads", label: "Downloads", icon: LuDownload, go: () => goSection("library", { tab: "downloads" }), match: (id, p) => id === "library" && p.tab === "downloads" },
  { id: "addons", label: "Addons", icon: LuPuzzle, go: () => goSection("settings", { section: "addons" }), match: (id, p) => id === "settings" && p.section === "addons" },
];

/** The nearest top-level place under the top of the stack (a title opened from Movies is still "Movies"). */
const placeOf = stack => {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    const id = entry.name === "search" ? "search" : sectionId(entry);
    if (entry.name === "search" || TABS.some(tab => tab.id === id) || entry.name === "settings") return { id, params: entry.params || {} };
  }
  return { id: "home", params: {} };
};

function RailButton({ item, active }) {
  const Icon = item.icon;
  return (
    <button className="hz-rail-item" aria-current={active ? "page" : undefined} aria-label={item.label} onClick={item.go}>
      <Icon aria-hidden="true" />
      <span className="hz-tip" aria-hidden="true">{item.label}{item.hint ? <kbd>{item.hint}</kbd> : null}</span>
    </button>
  );
}

/** Haze chrome: a rail of places down the side, section tabs and a search field across the top. */
export default function HazeChrome({ stack, profile }) {
  const { setAppearance } = useApp();
  const showBack = canGoBack();
  const place = placeOf(stack);
  const profileRef = useRef(null);
  const [card, setCard] = useState(null);
  const [closeRequest, setCloseRequest] = useState(0);
  const toggleCard = () => (card ? setCloseRequest(n => n + 1) : setCard({ view: "main" }));

  useEffect(() => {
    const open = event => setCard({ view: event.detail?.view || "main" });
    window.addEventListener(PROFILE_CARD, open);
    return () => window.removeEventListener(PROFILE_CARD, open);
  }, []);

  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [stack.length]);

  // One pill glides between the section tabs (and fades out where no tab is the place).
  const tabsRef = useRef(null);
  const [pill, setPill] = useState(null);
  useLayoutEffect(() => {
    const seat = () => {
      const node = tabsRef.current?.querySelector('[aria-current="page"]');
      setPill(prev => {
        const next = node ? { x: node.offsetLeft, w: node.offsetWidth } : null;
        return prev?.x === next?.x && prev?.w === next?.w ? prev : next;
      });
    };
    seat();
    document.fonts?.ready?.then(seat);
    window.addEventListener("resize", seat);
    return () => window.removeEventListener("resize", seat);
  }, [place.id]);

  const completed = useTopic("completed", []);
  const rank = useMemo(() => level(completed), [completed]);
  const streak = useMemo(() => streaks(completed).current, [completed]);
  const settingsOn = place.id === "settings" && place.params.section !== "addons";

  return (
    <>
      <aside className="hz-rail" aria-label="Places">
        <button
          ref={profileRef}
          className={`hz-rail-me${card ? " is-open" : ""}`}
          style={{ "--level": rank.progress }}
          onClick={toggleCard}
          aria-haspopup="dialog"
          aria-expanded={Boolean(card)}
          aria-label="Profile"
        >
          <Avatar profile={profile} />
          <span className="hz-tip" aria-hidden="true">{profile?.name || "Profile"}{completed.length ? <kbd>Level {rank.level}</kbd> : null}</span>
        </button>
        <nav className="hz-rail-list">
          {RAIL.map((item, i) => (item.gap ? <span key={`gap-${i}`} className="hz-rail-gap" /> : <RailButton key={item.id} item={item} active={item.match(place.id, place.params)} />))}
        </nav>
        <div className="hz-rail-foot">
          {streak >= 2 ? (
            <button className="hz-rail-streak num" onClick={() => goSection("library", { tab: "completed" })} aria-label={`${streak}-day streak. Open Trophies`}>
              <LuFlame aria-hidden="true" />{streak}
              <span className="hz-tip" aria-hidden="true">{streak}-day streak</span>
            </button>
          ) : null}
          <button className="hz-rail-item" aria-label="Switch to the Cinema look" onClick={() => switchLook("cinema", layout => setAppearance({ layout }))}>
            <LuSwatchBook aria-hidden="true" />
            <span className="hz-tip" aria-hidden="true">Cinema look<kbd>Ctrl Shift L</kbd></span>
          </button>
          <RailButton item={{ label: "Settings", icon: LuSettings, go: () => goSection("settings") }} active={settingsOn} />
        </div>
      </aside>

      <header className={`hz-top${solid ? " is-solid" : ""}${showBack ? " has-back" : ""}`}>
        <div className="hz-top-left">
          <button className="hz-back" onClick={back} aria-label="Back" title="Back (Esc)" tabIndex={showBack ? 0 : -1} aria-hidden={!showBack || undefined}>
            <LuArrowLeft />
          </button>
          <nav ref={tabsRef} className="topbar-nav hz-tabs" aria-label="Sections">
            <span className="hz-tab-pill" aria-hidden="true" style={pill ? { transform: `translateX(${pill.x}px)`, width: pill.w, opacity: 1 } : { opacity: 0 }} />
            {TABS.map(item => (
              <button
                key={item.id}
                data-id={item.id}
                className="hz-tab"
                aria-current={place.id === item.id ? "page" : undefined}
                onClick={() => goSection(item.route, item.kind ? { kind: item.kind } : {})}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <button className={`hz-search${place.id === "search" ? " is-on" : ""}`} onClick={focusSearch} aria-label="Search" aria-keyshortcuts="Control+K">
          <LuSearch aria-hidden="true" />
          <span>Search films, series, people</span>
          <kbd>Ctrl K</kbd>
        </button>
      </header>
      {card ? (
        <ProfileCard
          key={card.view}
          anchorRef={profileRef}
          initialView={card.view}
          closeRequest={closeRequest}
          onClose={() => { setCard(null); setCloseRequest(0); }}
        />
      ) : null}
    </>
  );
}
