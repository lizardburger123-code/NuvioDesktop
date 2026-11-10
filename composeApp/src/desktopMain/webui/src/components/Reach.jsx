import { useMemo } from "react";
import { LuCalendar, LuClock, LuFilm, LuFlame, LuHistory, LuHourglass, LuLayers, LuLibrary, LuMoon, LuStar, LuSun, LuTv } from "react-icons/lu";
import { useTopic } from "../store.js";
import { goSection } from "../lib/router.js";
import { inReach } from "../lib/trophies.js";
import "./Reach.css";

const ICONS = { shelf: LuLibrary, film: LuFilm, tv: LuTv, flame: LuFlame, layers: LuLayers, clock: LuClock, moon: LuMoon, history: LuHistory, star: LuStar, sun: LuSun, hourglass: LuHourglass, calendar: LuCalendar };

/** Trophies in reach: the three badges closest to their next tier, each a goal with a bar. */
export default function Reach() {
  const items = useTopic("completed", []);
  const goals = useMemo(() => inReach(items), [items]);
  if (!goals.length) return null;
  return (
    <section className="reach" aria-label="Trophies in reach">
      <h2 className="row-title">Trophies in reach</h2>
      <div className="reach-grid">
        {goals.map(goal => {
          const Icon = ICONS[goal.icon] || LuStar;
          return (
            <button key={goal.id} className={`reach-card tier-${goal.nextTier}`} onClick={() => goSection("library", { tab: "completed" })}>
              <span className="reach-medal" aria-hidden="true"><Icon /></span>
              <span className="reach-text">
                <span className="reach-line"><strong>{goal.name}</strong><span className="num">{goal.value} of {goal.next}</span></span>
                <span className="reach-bar"><span style={{ width: `${Math.round(goal.progress * 100)}%` }} /></span>
                <span className="reach-what">{goal.what} · next: {goal.nextTier}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
