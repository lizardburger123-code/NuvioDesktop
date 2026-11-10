import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuCalendar, LuClock, LuFilm, LuFlame, LuHistory, LuHourglass, LuLayers, LuLibrary, LuMoon, LuStar, LuSun, LuTrophy, LuTv } from "react-icons/lu";
import { useTopic } from "../store.js";
import { reduceMotion } from "../lib/motion.js";
import { navigate } from "../lib/router.js";
import { level, newlyEarned } from "../lib/trophies.js";
import "./TrophyToast.css";

const ICONS = { shelf: LuLibrary, film: LuFilm, tv: LuTv, flame: LuFlame, layers: LuLayers, clock: LuClock, moon: LuMoon, history: LuHistory, star: LuStar, sun: LuSun, hourglass: LuHourglass, calendar: LuCalendar };
const TIER_NAMES = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };
const SHOW_MS = 5200;

/**
 * The unlock moment, the console way: one card at a time in the top-right corner, never a modal.
 * First the case that just landed on the shelf, then each badge it raised, one after another.
 */
export default function TrophyToast() {
  const items = useTopic("completed", null);
  const seen = useRef(null);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    if (!Array.isArray(items)) return;
    if (seen.current == null) { seen.current = items; return; } // first load: nothing is new
    const before = seen.current;
    const known = new Set(before.map(i => `${i.type}:${i.id}`));
    const added = items.filter(i => !known.has(`${i.type}:${i.id}`));
    seen.current = items;
    if (!added.length) return;
    const cards = added.map(item => ({ kind: "case", key: `case:${item.type}:${item.id}`, item }));
    newlyEarned(before, items).forEach(badge => cards.push({ kind: "badge", key: `badge:${badge.id}:${badge.tier}`, badge }));
    const was = level(before).level;
    const now = level(items).level;
    if (now > was) cards.push({ kind: "level", key: `level:${now}`, level: now, toNext: level(items).toNext });
    setQueue(q => [...q, ...cards]);
  }, [items]);

  // Next card up, once the corner is free.
  useEffect(() => {
    if (current || !queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
  }, [queue, current]);

  // Each card stays its few seconds, then leaves. (Its own effect: sharing one with the queue
  // cancelled this timer as soon as the card appeared, so cards never left.)
  const showing = current && !current.leaving ? current.key : null;
  useEffect(() => {
    if (!showing) return undefined;
    const timer = window.setTimeout(() => setCurrent(c => (c ? { ...c, leaving: true } : c)), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [showing]);

  useEffect(() => {
    if (!current?.leaving) return undefined;
    const timer = window.setTimeout(() => setCurrent(null), 260);
    return () => window.clearTimeout(timer);
  }, [current]);

  if (!current) return null;
  return <Card card={current} onOpen={() => { navigate("library", { tab: "completed" }); setCurrent(c => ({ ...c, leaving: true })); }} />;
}

function Card({ card, onOpen }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current || reduceMotion()) return;
    ref.current.animate(
      [{ opacity: 0, transform: "translate3d(24px, 0, 0) scale(.96)" }, { opacity: 1, transform: "none" }],
      { duration: 520, easing: "cubic-bezier(.2, .9, .25, 1)" },
    );
  }, []);
  useLayoutEffect(() => {
    if (!card.leaving || !ref.current) return;
    ref.current.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(12px, 0, 0)" }],
      { duration: 240, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" },
    );
  }, [card.leaving]);

  if (card.kind === "case") {
    const { item } = card;
    return (
      <button ref={ref} className="ttoast" onClick={onOpen} aria-label={`${item.name} added to your trophies. Open Trophies`}>
        <span className="ttoast-case">{item.poster ? <img src={item.poster} alt="" /> : null}<i /></span>
        <span className="ttoast-text">
          <small>On the shelf</small>
          <strong dir="auto">{item.name}</strong>
          <span>{item.type === "series" ? "Series completed" : "Film completed"}</span>
        </span>
      </button>
    );
  }
  if (card.kind === "level") {
    return (
      <button ref={ref} className="ttoast ttoast-level" onClick={onOpen} aria-label={`Level ${card.level} reached. Open Trophies`}>
        <span className="ttoast-ring"><strong className="num">{card.level}</strong></span>
        <span className="ttoast-text">
          <small>Level up</small>
          <strong>Level {card.level}</strong>
          <span className="num">{card.toNext} more to level {card.level + 1}</span>
        </span>
      </button>
    );
  }
  const { badge } = card;
  const Icon = ICONS[badge.icon] || LuTrophy;
  return (
    <button ref={ref} className={`ttoast ttoast-badge badge-${badge.tier}`} onClick={onOpen} aria-label={`Badge earned: ${badge.name}, ${TIER_NAMES[badge.tier]}. Open Trophies`}>
      <span className="ttoast-medal"><Icon /></span>
      <span className="ttoast-text">
        <small>{TIER_NAMES[badge.tier]} badge</small>
        <strong>{badge.name}</strong>
        <span>{badge.what}</span>
      </span>
    </button>
  );
}
