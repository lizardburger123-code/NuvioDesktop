import { useEffect, useRef, useState } from "react";
import { LuCalendar, LuClock, LuFilm, LuFlame, LuHistory, LuHourglass, LuLayers, LuLibrary, LuMoon, LuStar, LuSun, LuTrophy, LuTv } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { reduceMotion } from "../lib/motion.js";
import { navigate } from "../lib/router.js";
import { level, newlyEarned } from "../lib/trophies.js";
import "./TrophyToast.css";

const ICONS = { shelf: LuLibrary, film: LuFilm, tv: LuTv, flame: LuFlame, layers: LuLayers, clock: LuClock, moon: LuMoon, history: LuHistory, star: LuStar, sun: LuSun, hourglass: LuHourglass, calendar: LuCalendar };
const TIER_NAMES = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };
const LAND_MS = 460;
const OPEN_MS = 3800;
const FOLD_MS = 460;
const LEAVE_MS = 360;
const pct = value => Math.round(Math.max(0, Math.min(1, value)) * 100);
const MODAL = "[data-modal-open], [aria-modal=\"true\"]";

/** A short two-note chime as the medal lands (three for platinum). */
let audio = null;
function chime(tier) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const notes = tier === "platinum" ? [659, 880, 1319] : tier === "level" ? [587, 880] : [784, 1175];
    notes.forEach((frequency, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const at = audio.currentTime + i * 0.11;
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 1);
    });
  } catch { /* sound is a nicety */ }
}

/**
 * The unlock moment, the console way: the medal lands in the bottom-right corner, the card opens
 * beside it to say what was earned and fills the level bar, then folds away. Finishing a film or
 * a series, the last episode of a season, a badge and a new level each get one, in that order.
 * While a film is still playing, the cards go to the player and show over the video instead.
 */
export default function TrophyToast() {
  const { appearance } = useApp();
  const items = useTopic("completed", null);
  const seasons = useTopic("seasonsDone", null);
  const seen = useRef(null);
  // Every title seen on the shelf this session, with when it was finished: one taken off and
  // put back (Undo) keeps its old time and is not new; one finished again moves on.
  const known = useRef(new Map());
  const seenSeasons = useRef(null);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [retry, setRetry] = useState(0);
  const sound = appearance?.trophySound !== false;

  const deliver = cards => {
    if (!cards.length) return;
    const stamped = cards.map(card => ({ ...card, sound, at: Date.now() }));
    // Over the video when the player is open; here otherwise.
    call("player.trophy", { cards: stamped }, { timeoutMs: 4000 }).then(
      shown => { if (!shown) setQueue(q => [...q, ...stamped]); },
      () => setQueue(q => [...q, ...stamped]),
    );
  };

  useEffect(() => {
    if (!Array.isArray(items)) return;
    const before = seen.current;
    const added = before == null ? [] : items.filter(i => {
      const at = known.current.get(`${i.type}:${i.id}`);
      return at == null || (i.completedAt || 0) - at > 60e3;
    });
    items.forEach(i => known.current.set(`${i.type}:${i.id}`, i.completedAt || 0));
    seen.current = items;
    if (!added.length) return; // the first load, a title put back, or one taken off
    const was = level(before);
    const now = level(items);
    const bar = { from: pct(was.progress), to: now.level > was.level ? 100 : pct(now.progress) };
    const cards = added.map(item => ({
      kind: "case", key: `case:${item.type}:${item.id}`, tier: "accent", image: item.poster,
      kicker: item.type === "series" ? "Series complete" : "Film finished",
      title: item.name,
      sub: item.type === "series" ? `Every episode watched${item.episodes ? ` · ${item.episodes}` : ""}` : "Added to your trophy shelf",
      ...bar,
    }));
    newlyEarned(before, items).forEach(badge => cards.push({
      kind: "badge", key: `badge:${badge.id}:${badge.tier}`, tier: badge.tier, icon: badge.icon,
      kicker: `Trophy earned · ${TIER_NAMES[badge.tier]}`, title: badge.name, sub: badge.what, ...bar,
    }));
    if (now.level > was.level) cards.push({
      kind: "level", key: `level:${now.level}`, tier: "accent", level: now.level,
      kicker: "Level up", title: `Level ${now.level}`,
      sub: `${now.toNext} ${now.toNext === 1 ? "finish" : "finishes"} to level ${now.level + 1}`, from: 0, to: pct(now.progress),
    });
    deliver(cards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    if (!Array.isArray(seasons)) return;
    if (seenSeasons.current == null) { seenSeasons.current = new Set(seasons.map(s => s.key)); return; }
    const fresh = seasons.filter(s => !seenSeasons.current.has(s.key));
    fresh.forEach(s => seenSeasons.current.add(s.key));
    deliver(fresh.reverse().map(s => ({
      kind: "season", key: `season:${s.key}`, tier: "accent", image: s.poster,
      kicker: s.final ? "Final season complete" : "Season complete",
      title: `${s.name} · Season ${s.season}`,
      sub: `${s.episodes} of ${s.episodes} episodes`,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasons]);

  // Next card up, once the corner is free and no dialog is open (a card would sit over it, and a
  // click meant for the dialog would open Trophies instead).
  useEffect(() => {
    if (current || !queue.length) return undefined;
    if (document.querySelector(MODAL)) {
      const wait = window.setTimeout(() => setRetry(n => n + 1), 1000);
      return () => window.clearTimeout(wait);
    }
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent({ ...next, phase: "in" });
    return undefined;
  }, [queue, current, retry]);

  // Each card: lands, opens, stays a few seconds, folds, goes.
  const key = current?.key;
  useEffect(() => {
    if (!key) return undefined;
    const quick = reduceMotion();
    const step = ms => (quick ? Math.min(ms, 80) : ms);
    if (current.sound !== false) chime(current.kind === "level" ? "level" : current.tier);
    const timers = [];
    let at = step(LAND_MS);
    timers.push(window.setTimeout(() => setCurrent(c => (c?.key === key ? { ...c, phase: "open" } : c)), at));
    at += OPEN_MS;
    timers.push(window.setTimeout(() => setCurrent(c => (c?.key === key ? { ...c, phase: "fold" } : c)), at));
    at += step(FOLD_MS);
    timers.push(window.setTimeout(() => setCurrent(c => (c?.key === key ? { ...c, phase: "out" } : c)), at));
    at += step(LEAVE_MS);
    timers.push(window.setTimeout(() => setCurrent(c => (c?.key === key ? null : c)), at));
    return () => timers.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!current) return null;
  return <Pop key={current.key} card={current} onOpen={() => navigate("library", { tab: "completed" })} />;
}

function Pop({ card, onOpen }) {
  // Mounted at "in" with the closed styles first, so the landing animates.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(frame); }, []);
  const Icon = ICONS[card.icon] || LuTrophy;
  const inView = mounted && card.phase !== "out";
  const open = card.phase === "open";
  const medal = card.kind === "level"
    ? <span className="tpop-level num">{card.level}</span>
    : (card.kind === "case" || card.kind === "season") && card.image ? <img src={card.image} alt="" /> : <Icon />;
  return (
    <button
      className={`tpop tpop-${card.kind}${card.image ? " has-image" : ""} tier-${card.tier || "gold"}${inView ? " is-in" : ""}${open ? " is-open" : ""}`}
      onClick={onOpen}
      role="status"
      aria-live="polite"
      aria-label={`${card.kicker}: ${card.title}. Open Trophies`}
    >
      <span className="tpop-medal">{medal}</span>
      <span className="tpop-text">
        <span className="tpop-in">
          <span className="tpop-kick">{card.kicker}</span>
          <span className="tpop-name" dir="auto">{card.title}</span>
          {card.sub ? <span className="tpop-sub" dir="auto">{card.sub}</span> : null}
        </span>
      </span>
      {card.to != null ? <span className="tpop-xp"><i style={{ "--from": `${card.from || 0}%`, "--to": `${card.to}%` }} /></span> : null}
    </button>
  );
}
