import { useEffect, useMemo, useRef, useState } from "react";
import { LuArrowLeft, LuFlame, LuSearch, LuSettings2 } from "react-icons/lu";
import { activeSection, back, canGoBack, goSection } from "../lib/router.js";
import { useTopic } from "../store.js";
import { level, streaks } from "../lib/trophies.js";
import { NAV_ITEMS, focusSearch } from "../lib/nav.js";
import { useApp } from "../AppContext.jsx";
import ProfileCard, { Avatar } from "./ProfileCard.jsx";
import HazeChrome from "../haze/Chrome.jsx";
import { lookOf } from "../lib/look.js";
import "./TopBar.css";

export { initials } from "./ProfileCard.jsx";

/** Open the profile card from anywhere (Settings uses it): detail { view: "picture" }. */
export const PROFILE_CARD = "nuvio:profile-card";

const SECTIONS = NAV_ITEMS.filter(item => item.inTopBar).map(item => ({
  ...item,
  id: item.kind ? `browse:${item.kind}` : item.route,
}));

/** Section switcher: plain words; the current one is white with a line under it. */
function SectionNav({ active }) {
  return (
    <nav className="topbar-nav" aria-label="Sections">
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
    </nav>
  );
}

export default function TopBar(props) {
  const { appearance } = useApp();
  return lookOf(appearance) === "haze" ? <HazeChrome stack={props.stack} profile={props.profile} /> : <CinemaBar {...props} />;
}

function CinemaBar({ route, stack, profile, compact }) {
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

  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [route]);

  const completed = useTopic("completed", []);
  const rank = useMemo(() => level(completed), [completed]);
  const streak = useMemo(() => streaks(completed).current, [completed]);
  const openTrophies = () => goSection("library", { tab: "completed" });

  return (
    <header className={`topbar${solid ? " is-solid" : ""}${showBack ? " has-back" : ""}`}>
      <div className="topbar-left">
        <button className="topbar-back" onClick={back} aria-label="Back" title="Back (Esc)" tabIndex={showBack ? 0 : -1} aria-hidden={!showBack || undefined}>
          <LuArrowLeft />
        </button>
        <button className="topbar-brand" onClick={() => goSection("home")} aria-label="Nuvio home">nuvio</button>
      </div>

      <SectionNav active={section} />

      <div className="topbar-right">
        {streak >= 2 ? (
          <button className="topbar-streak num" onClick={openTrophies} title={`${streak}-day streak`} aria-label={`${streak}-day streak. Open Trophies`}>
            <LuFlame aria-hidden="true" />{streak}
          </button>
        ) : null}
        <button className={`topbar-tool${section === "search" ? " is-on" : ""}`} aria-label="Search" aria-current={section === "search" ? "page" : undefined} title="Search (Ctrl+K)" onClick={focusSearch}>
          <LuSearch />
        </button>
        <button className={`topbar-tool${section === "settings" ? " is-on" : ""}`} aria-label="Settings" aria-current={section === "settings" ? "page" : undefined} title="Settings" onClick={() => goSection("settings")}>
          <LuSettings2 />
        </button>
        <button
          ref={profileRef}
          className={`topbar-profile${card ? " is-open" : ""}`}
          style={{ "--level": rank.progress }}
          onClick={toggleCard}
          aria-haspopup="dialog"
          aria-expanded={Boolean(card)}
          title={completed.length ? `Level ${rank.level} · ${completed.length} trophies` : "Profile"}
        >
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
