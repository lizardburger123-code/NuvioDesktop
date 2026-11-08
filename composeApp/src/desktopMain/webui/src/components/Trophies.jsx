import { useEffect, useMemo } from "react";
import { LuTrophy } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { year } from "../lib/format.js";
import "./Trophies.css";

const monthKey = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = key => new Date(`${key}-01T00:00:00`).toLocaleDateString([], { month: "long", year: "numeric" });

/** One finished film or series as a case on a shelf. */
export function Case({ item, onOpen, size = "m" }) {
  return (
    <button className={`case case-${size}`} onClick={() => onOpen?.(item)} title={item.name} aria-label={item.name}>
      <span className="case-box">
        {item.poster ? <img src={item.poster} alt="" loading="lazy" decoding="async" /> : <span className="case-blank">{item.name}</span>}
        <span className="case-spine" />
        <span className="case-gloss" />
      </span>
      <span className="case-ring" aria-hidden="true" />
      <span className="case-name" dir="auto">{item.name}</span>
      <span className="case-year num">{[item.type === "series" ? "Series" : null, year(item.releaseInfo)].filter(Boolean).join(" · ")}</span>
    </button>
  );
}

/** Everything watched to the end, shelved by month, newest first. */
export default function Trophies() {
  const { openDetails } = useApp();
  const items = useTopic("completed", []);
  useEffect(() => { call("home.subscribe").catch(() => {}); }, []);

  const shelves = useMemo(() => {
    const map = new Map();
    items.forEach(item => {
      const key = monthKey(item.completedAt || 0);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  const films = items.filter(i => i.type !== "series").length;
  const series = items.length - films;

  if (!items.length) {
    return (
      <section className="library-empty trophies-empty">
        <LuTrophy />
        <h2 className="t-title">No trophies yet</h2>
        <p className="t-meta">Watch a film to the end, or every episode of a series, and its case lands on this shelf.</p>
      </section>
    );
  }

  return (
    <section className="trophies">
      <div className="trophies-stats">
        <div><strong className="num">{items.length}</strong><span>completed</span></div>
        <div><strong className="num">{films}</strong><span>films</span></div>
        <div><strong className="num">{series}</strong><span>series</span></div>
      </div>
      {shelves.map(([key, list]) => (
        <section className="shelf" key={key}>
          <h2 className="shelf-title">{monthLabel(key)} <span className="num">{list.length}</span></h2>
          <div className="shelf-row">
            {list.map(item => <Case key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} />)}
          </div>
          <div className="shelf-board" aria-hidden="true" />
        </section>
      ))}
    </section>
  );
}
