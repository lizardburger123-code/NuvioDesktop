import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuBookmark, LuInfo, LuPlay } from "react-icons/lu";
import { EASE, reduceMotion } from "../lib/motion.js";
import { useScreenActive } from "../lib/screen.js";
import { episodeCode, minutesLeft, year } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import "./Showcase.css";

const openDetails = item => navigate("details", { type: item.type, id: item.id, name: item.name });

/** Backdrop that cross-fades after the next picture has decoded, with a slow drift while it shows. */
function Art({ src }) {
  const [layers, setLayers] = useState(() => (src ? [{ src, id: 0 }] : []));
  const id = useRef(0);
  const last = useRef(null);
  useEffect(() => {
    if (!src || layers[layers.length - 1]?.src === src) return undefined;
    let alive = true;
    const img = new Image();
    img.src = src;
    const swap = () => {
      if (!alive) return;
      id.current += 1;
      setLayers(prev => [...prev.slice(-1), { src, id: id.current }]);
    };
    (img.decode ? img.decode() : Promise.resolve()).then(swap, swap);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  useLayoutEffect(() => {
    if (!last.current || reduceMotion()) return;
    if (layers.length > 1) last.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1100, easing: EASE.glide });
    last.current.animate([{ transform: "scale(1.02)" }, { transform: "scale(1.08)" }], { duration: 11000, easing: "linear", fill: "forwards" });
  }, [layers]);
  return (
    <div className="showcase-art" aria-hidden="true">
      {layers.map((layer, i) => (
        <img key={layer.id} ref={i === layers.length - 1 ? last : undefined} src={layer.src} alt="" decoding="async" />
      ))}
    </div>
  );
}

/**
 * The first screen of Home: one film or series at a time, full width, with its own backdrop and
 * logo, and the thing you were watching last tucked into the corner.
 */
export default function Showcase({ items = [], resumeEntry, onPlay, onResume, onToggleLater, laterIds }) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const bodyRef = useRef(null);
  const first = useRef(true);
  const active = useScreenActive();
  const item = items[index % Math.max(1, items.length)];

  useEffect(() => {
    if (items.length < 2 || !active || held) return undefined;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % items.length), 10000);
    return () => window.clearInterval(timer);
  }, [items.length, active, held]);

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (!bodyRef.current || reduceMotion()) return undefined;
    const animations = [...bodyRef.current.children].map((part, i) => part.animate(
      [{ opacity: 0, transform: "translate3d(0, 12px, 0)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
      { duration: 640, delay: 160 + i * 60, easing: EASE.out, fill: "backwards" },
    ));
    return () => animations.forEach(animation => animation.cancel());
  }, [index]);

  if (!item) return <section className="showcase skel" aria-hidden="true" />;
  const saved = laterIds?.has(`${item.type}:${item.id}`);
  const meta = [year(item.releaseInfo), item.genres?.slice(0, 2).join(" · "), item.imdbRating ? `IMDb ${item.imdbRating}` : null].filter(Boolean);

  return (
    <section className="showcase" aria-label="Showcase" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
      <Art src={item.banner || item.poster} />
      <div className="showcase-scrim" />
      <div className="showcase-body" ref={bodyRef}>
        {item.logo ? <img className="showcase-logo" src={item.logo} alt={item.name} /> : <h2 className="showcase-name">{item.name}</h2>}
        <p className="showcase-meta">{meta.map((part, i) => <span key={i}>{part}</span>)}</p>
        {item.description ? <p className="showcase-desc">{item.description}</p> : null}
        <div className="showcase-actions">
          <button className="btn btn-primary" onClick={() => onPlay?.(item)}><LuPlay /> Play</button>
          <button className="btn btn-glass" onClick={() => openDetails(item)}><LuInfo /> Details</button>
          <button className={`btn btn-glass btn-icon${saved ? " is-on" : ""}`} aria-pressed={saved} aria-label={saved ? "Remove from Watch later" : "Watch later"} onClick={() => onToggleLater?.(item)}><LuBookmark /></button>
        </div>
      </div>

      {resumeEntry ? (
        <button className="showcase-resume" onClick={() => onResume?.(resumeEntry)} aria-label={`Resume ${resumeEntry.name}`}>
          <span className="showcase-resume-art" style={{ backgroundImage: `url("${resumeEntry.thumbnail || resumeEntry.backdrop || ""}")` }}>
            <LuPlay />
          </span>
          <span className="showcase-resume-text">
            <small>Continue</small>
            <strong>{resumeEntry.name}</strong>
            <span className="num">{[episodeCode(resumeEntry.season, resumeEntry.episode), minutesLeft(resumeEntry.positionMs, resumeEntry.durationMs)].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="showcase-resume-bar"><span style={{ width: `${Math.round((resumeEntry.progress || 0) * 100)}%` }} /></span>
        </button>
      ) : null}

      {items.length > 1 ? (
        <div className="showcase-dots" role="tablist" aria-label="Showcase">
          {items.map((entry, i) => (
            <button key={`${entry.type}:${entry.id}`} role="tab" aria-selected={i === index % items.length} aria-label={entry.name} onClick={() => setIndex(i)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
