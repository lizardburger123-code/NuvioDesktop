import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuPlay } from "react-icons/lu";
import { EASE, reduceMotion } from "../lib/motion.js";
import { useScreenActive } from "../lib/screen.js";
import { year } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { lookOf } from "../lib/look.js";
import { useApp } from "../AppContext.jsx";
import HazeHero from "../haze/Hero.jsx";
import "./Showcase.css";

const openDetails = item => navigate("details", { type: item.type, id: item.id, name: item.name, ...(item.season ? { season: item.season } : {}) });

/**
 * Backdrop that cross-fades after the next picture has decoded, with a slow drift while it shows.
 * When a picture won't load, its [fallback] takes its place (AniList's own banner, say).
 */
export function Art({ src, fallback }) {
  const [layers, setLayers] = useState(() => (src ? [{ src, fallback, id: 0 }] : []));
  const id = useRef(0);
  const last = useRef(null);
  useEffect(() => {
    if (!src || layers[layers.length - 1]?.src === src) return undefined;
    let alive = true;
    const show = (next, alt) => {
      if (!alive) return;
      id.current += 1;
      setLayers(prev => [...prev.slice(-1), { src: next, fallback: alt, id: id.current }]);
    };
    const load = (next, alt) => {
      const img = new Image();
      img.src = next;
      (img.decode ? img.decode() : Promise.resolve()).then(
        () => show(next, null),
        () => (alt ? load(alt, null) : show(next, null)),
      );
    };
    load(src, fallback);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  const failed = layer => {
    if (!layer.fallback) return;
    setLayers(prev => prev.map(entry => (entry.id === layer.id ? { ...entry, src: entry.fallback, fallback: null } : entry)));
  };
  useLayoutEffect(() => {
    if (!last.current || reduceMotion()) return;
    if (layers.length > 1) last.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1100, easing: EASE.glide });
    last.current.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)" }], { duration: 14000, easing: "linear", fill: "forwards" });
  }, [layers]);
  return (
    <div className="showcase-art" aria-hidden="true">
      {layers.map((layer, i) => (
        <img key={layer.id} ref={i === layers.length - 1 ? last : undefined} src={layer.src} alt="" decoding="async" onError={() => failed(layer)} />
      ))}
    </div>
  );
}

/** The title as its logo, or in type when there's no logo (or it won't load). */
export function Title({ item }) {
  const [broken, setBroken] = useState(false);
  if (item.logo && !broken) return <img className="showcase-logo" src={item.logo} alt={item.name} onError={event => { if (event.currentTarget.dataset.broken) setBroken(true); }} />;
  return <h2 className="showcase-name" dir="auto">{item.name}</h2>;
}

// Pictures asked for ahead of time, so the next title's backdrop and logo are ready to show.
// The image itself is kept with its promise: while it is held, the page reuses it at once.
const warmed = new Map();
const warm = url => {
  if (!warmed.has(url)) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    warmed.set(url, { img, ready: (img.decode ? img.decode() : Promise.resolve()).catch(() => {}) });
  }
  return warmed.get(url).ready;
};
const warmTitle = item => Promise.all([item?.banner || item?.poster, item?.logo].filter(Boolean).map(warm));

const ROTATE_MS = 12000;

/**
 * Which featured title shows, moving on every 12 seconds. It holds while the pointer or the
 * keyboard is on the hero, while the window is hidden and while the screen is parked. The next
 * title's picture and logo load while this one shows, and the move waits for them (a few
 * seconds at most), so the words and the picture change together and the logo never pops in.
 */
export function useFeatured(items) {
  const active = useScreenActive();
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [shown, setShown] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const onVisibility = () => setShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const count = items.length;
  const current = count ? index % count : 0;
  const held = hover || focus || !shown || !active;

  useEffect(() => {
    if (count > 1 && active) warmTitle(items[(current + 1) % count]);
  }, [items, count, current, active]);

  useEffect(() => {
    if (count < 2 || held) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const next = (current + 1) % count;
      const ready = Promise.race([warmTitle(items[next]), new Promise(resolve => window.setTimeout(resolve, 4000))]);
      ready.then(() => { if (!cancelled) setIndex(next); });
    }, ROTATE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [items, count, current, held]);

  const bind = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onFocus: () => setFocus(true),
    // Moving between the hero's own buttons is still being on the hero.
    onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocus(false); },
  };
  return { index: current, show: setIndex, held, bind };
}

/** Dashes for the featured titles: each one shows its title; the current one is marked. */
export function FeaturedPicker({ items, index, onPick, className }) {
  if (items.length < 2) return null;
  return (
    <div className={className} role="group" aria-label="Featured titles">
      {items.map((entry, i) => (
        <button key={`${entry.type}:${entry.id}`} aria-label={`Show ${entry.name}`} aria-current={i === index ? "true" : undefined} onClick={() => onPick(i)} />
      ))}
    </div>
  );
}

/** "Episode 1181 in 3 days": when an airing anime's next episode comes out. */
export const nextEpisodeLabel = item => {
  if (!item?.nextEpisode || !item.nextAt) return null;
  const days = Math.round((item.nextAt - Date.now()) / 864e5);
  if (days < 0) return null;
  return `Episode ${item.nextEpisode} ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`;
};

/**
 * The first screen of Home: one film or series at a time, full width, with its own backdrop and
 * logo, and the thing you were watching last tucked into the corner.
 */
export default function Showcase(props) {
  const { appearance } = useApp();
  return lookOf(appearance) === "haze" ? <HazeHero {...props} /> : <CinemaShowcase {...props} />;
}

function CinemaShowcase({ items = [], strip = false, short = false, onPlay, onToggleLater, laterIds }) {
  const { index, show, held, bind } = useFeatured(items);
  const bodyRef = useRef(null);
  const first = useRef(true);
  const item = items[index];

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
  const meta = [
    year(item.releaseInfo), ...(item.genres?.slice(0, 2) || []),
    item.imdbRating ? `IMDb ${item.imdbRating}` : item.score ? `AniList ${item.score}%` : null,
    nextEpisodeLabel(item),
  ].filter(Boolean);
  const kicker = item.anilist != null || item.score != null
    ? (item.type === "movie" ? "Anime film" : "Anime series")
    : (item.type === "series" ? "Featured series" : "Featured film");

  return (
    <section className={`showcase${shape}`} aria-roledescription="carousel" aria-label="Featured" {...bind}>
      <Art src={item.banner || item.poster} fallback={item.bannerAlt || item.poster} />
      <div className="showcase-scrim" />
      <div
        className="showcase-body"
        ref={bodyRef}
        role="group"
        aria-roledescription="slide"
        aria-label={`${index + 1} of ${items.length}: ${item.name}`}
        aria-live={held ? "polite" : "off"}
      >
        <span className="showcase-kicker">{kicker}</span>
        <Title key={`${item.type}:${item.id}`} item={item} />
        <p className="showcase-meta num">{meta.map((part, i) => <span key={i}>{part}</span>)}</p>
        {item.description ? <p className="showcase-desc" dir="auto">{item.description}</p> : null}
        <div className="showcase-actions">
          <button className="btn btn-primary" onClick={() => onPlay?.(item)} aria-label={`Play ${item.name}`}><LuPlay /> Play</button>
          <button className={`btn btn-glass${saved ? " is-on" : ""}`} onClick={() => onToggleLater?.(item)} aria-label={saved ? `Remove ${item.name} from My list` : `Add ${item.name} to My list`}>{saved ? "In my list" : "Add to list"}</button>
          <button className="btn btn-line" onClick={() => openDetails(item)} aria-label={`About ${item.name}`}>Details</button>
          <FeaturedPicker className="showcase-dots" items={items} index={index} onPick={show} />
        </div>
      </div>
    </section>
  );
}
