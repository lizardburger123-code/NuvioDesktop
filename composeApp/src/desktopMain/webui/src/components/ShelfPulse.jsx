import { useMemo } from "react";
import { LuFlame, LuTrophy } from "react-icons/lu";
import { useTopic } from "../store.js";
import { navigate } from "../lib/router.js";
import { fmtHours, stats } from "../lib/trophies.js";
import "./ShelfPulse.css";

/** One quiet line on Home about the shelf: the streak when there is one, else what this month holds. */
export default function ShelfPulse() {
  const items = useTopic("completed", []);
  const s = useMemo(() => stats(items), [items]);
  if (!items.length) return null;
  const parts = [];
  if (s.current >= 2) parts.push({ icon: LuFlame, text: `${s.current}-day streak`, hot: true });
  if (s.thisMonth) parts.push({ text: `${s.thisMonth} finished this month` });
  if (s.totalMs) parts.push({ text: `${fmtHours(s.totalMs)} watched` });
  if (!parts.length) return null;
  return (
    <button className="pulse" onClick={() => navigate("library", { tab: "completed" })} aria-label="Open Trophies">
      <LuTrophy className="pulse-trophy" aria-hidden="true" />
      {parts.slice(0, 2).map((part, i) => {
        const Icon = part.icon;
        return (
          <span key={i} className={`pulse-part${part.hot ? " is-hot" : ""}`}>
            {Icon ? <Icon aria-hidden="true" /> : null}{part.text}
          </span>
        );
      })}
    </button>
  );
}
