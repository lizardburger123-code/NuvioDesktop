import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuPlay } from "react-icons/lu";
import { EASE, reduceMotion } from "../lib/motion.js";
import { useScreenActive } from "../lib/screen.js";
import { year } from "../lib/format.js";
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
    last.current.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)" }], { duration: 14000, easing: "linear", fill: "forwards" });
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
export default function Showcase({ items = [], strip = false, short = false, onPlay, onToggleLater, laterIds }) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const bodyRef = useRef(null);
  const first = useRef(true);
  const active = useScreenActive();
  const item = items[index % Math.max(1, items.length)];

  useEffect(() => {
    if (items.length < 2 || !active || held) return undefined;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % items.length), 12000);
    return () => window.clearInterval(timer);
  }, [items.length, active, held]);

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (!bodyRef.current || reduceMotion()) return undefined;
    const animations = [...bodyRef.current.children].map((part, i) => part.animate(
      [{ opacity: 0, transform: "translate3d(0, 10px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 520, delay: 120 + i * 50, easing: EASE.out, fill: "backwards" },
    ));
    return () => animations.forEach(animation => animation.cancel());
  }, [index]);

  const shape = `${short ? " is-short" : ""}${strip ? " has-strip" : ""}`;
  if (!item) return <section className={`showcase skel${shape}`} aria-hidden="true" />;
  const saved = laterIds?.has(`${item.type}:${item.id}`);
  const meta = [year(item.releaseInfo), ...(item.genres?.slice(0, 2) || []), item.imdbRating ? `IMDb ${item.imdbRating}` : null].filter(Boolean);

  return (
    <section className={`showcase${shape}`} aria-label="Featured" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
      <Art src={item.banner || item.poster} />
      <div className="showcase-scrim" />
      <div className="showcase-body" ref={bodyRef}>
        <span className="showcase-kicker">{item.type === "series" ? "Featured series" : "Featured film"}</span>
        {item.logo ? <img className="showcase-logo" src={item.logo} alt={item.name} /> : <h2 className="showcase-name" dir="auto">{item.name}</h2>}
        <p className="showcase-meta num">{meta.map((part, i) => <span key={i}>{part}</span>)}</p>
        {item.description ? <p className="showcase-desc" dir="auto">{item.description}</p> : null}
        <div className="showcase-actions">
          <button className="btn btn-primary" onClick={() => onPlay?.(item)}><LuPlay /> Play</button>
          <button className={`btn btn-glass${saved ? " is-on" : ""}`} aria-pressed={saved} onClick={() => onToggleLater?.(item)}>{saved ? "In my list" : "Add to list"}</button>
          <button className="btn btn-line" onClick={() => openDetails(item)}>Details</button>
          {items.length > 1 ? (
            <div className="showcase-dots" role="tablist" aria-label="Featured titles">
              {items.map((entry, i) => (
                <button key={`${entry.type}:${entry.id}`} role="tab" aria-selected={i === index % items.length} aria-label={entry.name} onClick={() => setIndex(i)} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
