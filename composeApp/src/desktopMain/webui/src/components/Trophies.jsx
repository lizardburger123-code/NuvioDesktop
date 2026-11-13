import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LuCalendar, LuClock, LuFilm, LuFlame, LuHistory, LuHourglass, LuLayers, LuLibrary, LuMoon, LuStar, LuSun, LuTrophy, LuTv,
} from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { EASE, reduceMotion } from "../lib/motion.js";
import { badges, fmtHours, level, stats, yearGrid } from "../lib/trophies.js";
import Reach from "./Reach.jsx";
import Shelf from "./Shelf.jsx";
import { navigate } from "../lib/router.js";
import "./Trophies.css";

const ICONS = { shelf: LuLibrary, film: LuFilm, tv: LuTv, flame: LuFlame, layers: LuLayers, clock: LuClock, moon: LuMoon, history: LuHistory, star: LuStar, sun: LuSun, hourglass: LuHourglass, calendar: LuCalendar };
const TIER_NAMES = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };

const monthKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthLabel = key => new Date(`${key}-01T00:00:00`).toLocaleDateString([], { month: "long", year: "numeric" });
const ago = ms => {
  const days = Math.floor((Date.now() - ms) / 86400e3);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
};

/** A badge: metal when earned, with the distance to the next tier underneath. */
function Badge({ badge }) {
  const Icon = ICONS[badge.icon] || LuTrophy;
  return (
    <div className={`badge badge-${badge.earned ? badge.tier : "locked"}`} title={`${badge.name}: ${badge.what}`}>
      <span className="badge-medal"><Icon /></span>
      <span className="badge-text">
        <strong>{badge.name}</strong>
        <span>{badge.earned ? TIER_NAMES[badge.tier] : badge.what}</span>
      </span>
      <span className="badge-progress" aria-label={badge.maxed ? "Top tier" : `${badge.value} of ${badge.next}`}>
        <span className="badge-bar"><i style={{ width: `${Math.round((badge.maxed ? 1 : badge.progress) * 100)}%` }} /></span>
        <span className="badge-count num">{badge.maxed ? "Max" : `${badge.value} / ${badge.next}`}</span>
      </span>
    </div>
  );
}

/** A year of finishes, one cell per day. */
function YearGrid({ items }) {
  const grid = useMemo(() => yearGrid(items), [items]);
  return (
    <div className="ygrid" role="img" aria-label="Finishes over the last year">
      <div className="ygrid-months">
        {grid.months.map(m => <span key={m.week + m.label} style={{ gridColumn: m.week + 1 }}>{m.label}</span>)}
      </div>
      <div className="ygrid-cells">
        {grid.weeks.map((week, w) => week.map((cell, d) => (
          <i
            key={`${w}-${d}`}
            className={cell.count < 0 ? "is-future" : cell.count ? `l${Math.min(4, Math.ceil((cell.count / grid.max) * 4))}` : ""}
            title={cell.count > 0 ? `${new Date(cell.day).toLocaleDateString([], { month: "short", day: "numeric" })}: ${cell.count} finished` : undefined}
          />
        )))}
      </div>
    </div>
  );
}

/**
 * Trophies: everything watched to the end, shown as cases on lit shelves, with the badges and the
 * year they add up to. All of it is computed from the same list, so the numbers always match the
 * cases below them.
 */
export default function Trophies() {
  const { openDetails, toast } = useApp();
  const items = useTopic("completed", []);
  const rootRef = useRef(null);
  const [view, setView] = useState("shelf");
  useEffect(() => { call("home.subscribe").catch(() => {}); }, []);

  const s = useMemo(() => stats(items), [items]);
  const all = useMemo(() => badges(items), [items]);
  const earned = all.filter(b => b.earned);
  const latest = items[0];
  const rank = useMemo(() => level(items), [items]);

  const shelves = useMemo(() => {
    const map = new Map();
    items.forEach(item => {
      const key = monthKey(item.completedAt || 0);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  // The page settles in once: figures, then badges, then the first shelf.
  useLayoutEffect(() => {
    if (!rootRef.current || reduceMotion()) return undefined;
    const parts = rootRef.current.querySelectorAll("[data-rise]");
    const animations = [...parts].map((part, i) => part.animate(
      [{ opacity: 0, transform: "translate3d(0, 10px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 480, delay: 60 + i * 50, easing: EASE.out, fill: "backwards" },
    ));
    return () => animations.forEach(a => a.cancel());
  }, [items.length > 0]);

  // Taking a case off the shelf keeps it off, even if the title is watched again.
  const remove = item => {
    call("completed.remove", { type: item.type, id: item.id }).catch(error => toast(error.message, { tone: "error" }));
    toast(`${item.name} removed from trophies`, { action: { label: "Undo", run: () => call("completed.restore", { type: item.type, id: item.id }) } });
  };

  if (!items.length) {
    return (
      <section className="trophies-empty" ref={rootRef}>
        <div className="trophies-empty-shelf" aria-hidden="true"><span /><span /><span /></div>
        <h2>Your shelf is empty</h2>
        <p>Watch a film to the end, or every episode of a series, and its case lands here. Badges unlock as the shelf fills.</p>
        <div className="badge-rail is-preview">{all.slice(0, 4).map(b => <Badge key={b.id} badge={b} />)}</div>
      </section>
    );
  }

  return (
    <section className="trophies" ref={rootRef}>
      <header className="trophies-top" data-rise>
        <div className="level-ring" style={{ "--p": rank.progress }} role="img" aria-label={`Level ${rank.level}`}>
          <strong className="num">{rank.level}</strong>
          <span>Level</span>
        </div>
        <div className="trophies-lead">
          <span className="trophies-kicker">{rank.toNext === 1 ? "One more to level up" : `${rank.toNext} more to level ${rank.level + 1}`}</span>
          <h2 className="trophies-headline"><span className="num">{s.total}</span> finished</h2>
          <p>
            {latest ? <>Latest: <bdi>{latest.name}</bdi>, {ago(latest.completedAt)}. </> : null}
            {[s.films ? `${s.films} ${s.films === 1 ? "film" : "films"}` : null, s.series ? `${s.series} series` : null].filter(Boolean).join(" and ")} on the shelf.
          </p>
        </div>
        <dl className="trophies-figures">
          <div><dt>Watched</dt><dd className="num">{fmtHours(s.totalMs)}</dd><small>{s.timed < s.total ? `${s.total - s.timed} without a time` : "from the player"}</small></div>
          <div><dt>Streak</dt><dd className="num">{s.current} <em>{s.current === 1 ? "day" : "days"}</em></dd><small>longest {s.longest}</small></div>
          <div><dt>This month</dt><dd className="num">{s.thisMonth}</dd><small>{s.topMonth ? `best ${s.topMonth.label.split(" ")[0]}: ${s.topMonth.count}` : ""}</small></div>
        </dl>
      </header>

      <Reach heading="In reach" />

      <div className="trophies-row" data-rise>
        <h2 className="trophies-h">Badges <span className="num">{earned.length} of {all.length}</span></h2>
      </div>
      <div className="badge-rail" data-rise>
        {[...all].sort((a, b) => Number(b.earned) - Number(a.earned)).map(b => <Badge key={b.id} badge={b} />)}
      </div>

      <div className="trophies-row" data-rise>
        <h2 className="trophies-h">{view === "year" ? "The year" : "The shelf"}</h2>
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === "shelf"} onClick={() => setView("shelf")}>By month</button>
          <button aria-pressed={view === "year"} onClick={() => setView("year")}>Year</button>
        </div>
      </div>

      {view === "year" ? (
        <section className="trophies-year" data-rise>
          <YearGrid items={items} />
          <p className="t-meta">{s.thisYear} finished this year{s.oldest ? ` · oldest film from ${s.oldest}` : ""}{s.decades > 1 ? ` · ${s.decades} decades` : ""}</p>
        </section>
      ) : (
        <Shelf
          shelves={shelves}
          label={monthLabel}
          onDetails={openDetails}
          onPlay={item => navigate("details", { type: item.type, id: item.id, name: item.name, autoplay: true })}
          onRemove={remove}
        />
      )}
    </section>
  );
}
