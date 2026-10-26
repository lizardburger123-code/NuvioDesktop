import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EASE, reduceMotion } from "../lib/motion.js";
import { useScreenActive } from "../lib/screen.js";
import { LuBookmark, LuCalendarClock, LuEyeOff, LuInfo, LuLibrary, LuPlay, LuSkipForward } from "react-icons/lu";
import SpotlightCard from "../reactbits/SpotlightCard/SpotlightCard.jsx";
import { episodeCode, minutesLeft, relativeAir, clockTime, year } from "../lib/format.js";
import { goSection, navigate } from "../lib/router.js";
import "./Tiles.css";

const openDetails = item => navigate("details", { type: item.type, id: item.id, name: item.name });

function Tile({ className = "", children, style, onClick, label, onHide, hideLabel }) {
  const active = useScreenActive();
  return (
    <SpotlightCard
      paused={!active}
      className={`tile ${className}`}
      style={style}
      spotlightColor="rgba(255, 255, 255, 0.22)"
      intensity={0.2}
      spotlightSize={320}
      borderGlow={0.5}
    >
      {onClick ? <button className="tile-hit" onClick={onClick} aria-label={label} /> : null}
      {children}
      {onHide ? (
        <button className="tile-hide" onClick={event => { event.stopPropagation(); onHide(); }} aria-label={hideLabel || "Hide this tile"} title="Hide from Home">
          <LuEyeOff />
        </button>
      ) : null}
    </SpotlightCard>
  );
}

/** Artwork that cross-fades (after decoding) instead of cutting when the picture changes. */
function TileArt({ src }) {
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
    if (layers.length < 2 || !last.current || reduceMotion()) return;
    last.current.animate(
      [{ opacity: 0, transform: "scale(1.04)" }, { opacity: 1, transform: "none" }],
      { duration: 900, easing: EASE.glide },
    );
  }, [layers]);
  return (
    <div className="tile-art" aria-hidden="true">
      {layers.map((layer, i) => (
        <img key={layer.id} ref={i === layers.length - 1 ? last : undefined} src={layer.src} alt="" decoding="async" />
      ))}
    </div>
  );
}

export function SpotlightTile({ items = [], onPlay, onHide }) {
  const [index, setIndex] = useState(0);
  const bodyRef = useRef(null);
  const first = useRef(true);
  const active = useScreenActive();
  const item = items[index % Math.max(1, items.length)];

  // Rotate only while Home is on screen (a parked Home shouldn't keep re-rendering).
  useEffect(() => {
    if (items.length < 2 || !active) return undefined;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % items.length), 9000);
    return () => window.clearInterval(timer);
  }, [items.length, active]);

  // New title: the copy writes itself in, each line on its own element.
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    if (!bodyRef.current || reduceMotion()) return undefined;
    const parts = [...bodyRef.current.children];
    const animations = parts.map((part, i) => part.animate(
      [{ opacity: 0, transform: "translate3d(0, 10px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 560, delay: 120 + i * 50, easing: EASE.out, fill: "backwards" },
    ));
    return () => animations.forEach(animation => animation.cancel());
  }, [index]);

  if (!item) return <div className="tile tile-spotlight skel" />;
  return (
    <Tile className="tile-spotlight" onClick={() => openDetails(item)} label={item.name} onHide={onHide} hideLabel="Hide Spotlight">
      <TileArt src={item.banner || item.poster} />
      <div className="tile-scrim" />
      <div className="tile-body" ref={bodyRef}>
        <span className="tile-kicker">Spotlight</span>
        {item.logo ? <img className="tile-logo" src={item.logo} alt={item.name} /> : <h3 className="tile-name">{item.name}</h3>}
        <span className="tile-meta">
          {[year(item.releaseInfo), item.genres?.slice(0, 2).join(" · "), item.imdbRating ? `IMDb ${item.imdbRating}` : null].filter(Boolean).join("  ·  ")}
        </span>
        <div className="tile-actions">
          <button className="btn btn-primary btn-sm" onClick={event => { event.stopPropagation(); onPlay?.(item); }}>
            <LuPlay /> Play
          </button>
          <button className="btn btn-glass btn-sm" onClick={event => { event.stopPropagation(); openDetails(item); }}>
            <LuInfo /> Details
          </button>
        </div>
      </div>
      {items.length > 1 ? (
        <div className="tile-dots" role="tablist" aria-label="Spotlight">
          {items.map((entry, i) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={i === index}
              aria-label={entry.name}
              className="tile-dot"
              onClick={event => { event.stopPropagation(); setIndex(i); }}
            />
          ))}
        </div>
      ) : null}
    </Tile>
  );
}

export function ResumeTile({ entry, onResume, onHide }) {
  if (!entry) {
    return (
      <Tile className="tile-resume tile-empty" onHide={onHide} hideLabel="Hide Resume">
        <div className="tile-body">
          <span className="tile-kicker">Resume</span>
          <p className="tile-empty-text">Start something and it will wait for you here.</p>
        </div>
      </Tile>
    );
  }
  return (
    <Tile className="tile-resume" style={{ backgroundImage: `url("${entry.thumbnail || entry.backdrop}")` }} onClick={() => onResume(entry)} label={`Resume ${entry.name}`} onHide={onHide} hideLabel="Hide Resume">
      <div className="tile-scrim tile-scrim-strong" />
      <div className="tile-body">
        <span className="tile-kicker">Resume</span>
        <h3 className="tile-name tile-name-sm">{entry.name}</h3>
        <span className="tile-meta">
          {[episodeCode(entry.season, entry.episode), entry.episodeTitle].filter(Boolean).join("  ·  ")}
        </span>
        <div className="tile-player">
          <div className="tile-progress" aria-label={`${Math.round((entry.progress || 0) * 100)}% watched`}>
            <span style={{ width: `${Math.round((entry.progress || 0) * 100)}%` }} />
          </div>
          <div className="tile-player-row">
            <span className="tile-left num">{minutesLeft(entry.positionMs, entry.durationMs)}</span>
            <span className="tile-player-buttons">
              <button className="tile-round tile-round-main" aria-label="Resume" onClick={event => { event.stopPropagation(); onResume(entry); }}>
                <LuPlay />
              </button>
              {entry.season != null ? (
                <button className="tile-round" aria-label="Next episode" onClick={event => { event.stopPropagation(); onResume({ ...entry, nextEpisode: true }); }}>
                  <LuSkipForward />
                </button>
              ) : null}
            </span>
          </div>
        </div>
      </div>
    </Tile>
  );
}

const newestFirst = items => [...items].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

/** Three posters from the shelf, newest first; each opens its title. */
function Shelf({ items }) {
  return (
    <div className="tile-shelf">
      {items.map((item, i) => (
        <button
          key={`${item.type}:${item.id}`}
          className="tile-shelf-item"
          style={{ "--i": i }}
          onClick={event => { event.stopPropagation(); openDetails(item); }}
          aria-label={item.name}
          title={item.name}
        >
          {item.poster ? <img src={item.poster} alt="" loading="lazy" decoding="async" /> : <span className="tile-shelf-fallback" dir="auto">{item.name}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Watch later or Library: what's inside at a glance — the count and the three most recently
 * added — opening the full list.
 */
export function CollectionTile({ kind, items = [], upcoming = [], onHide }) {
  const later = kind === "later";
  const recent = newestFirst(items).slice(0, 8);
  const next = later ? null : upcoming[0];
  const Icon = later ? LuBookmark : LuLibrary;
  const title = later ? "Watch later" : "Library";
  const open = () => goSection("library", { tab: later ? "later" : "saved" });
  return (
    <Tile
      className={`tile-collection ${later ? "tile-later" : "tile-schedule"}`}
      onClick={open}
      label={`${title}: ${items.length} ${items.length === 1 ? "title" : "titles"}`}
      onHide={onHide}
      hideLabel={`Hide ${title}`}
    >
      <div className="tile-body tile-collection-body">
        <span className="tile-collection-head">
          <span className="tile-kicker"><Icon /> {title}</span>
          <span className="tile-collection-count num">{items.length}</span>
        </span>
        {recent.length ? (
          <Shelf items={recent} />
        ) : (
          <p className="tile-empty-text">{later ? "Tap the bookmark on any poster to keep it here." : "Titles you add to your library show here."}</p>
        )}
        {next ? (
          <button
            className="tile-next"
            onClick={event => { event.stopPropagation(); openDetails(next); }}
            title={`${next.name} ${episodeCode(next.season, next.episode)} · ${relativeAir(next.airsAt)}`}
          >
            <LuCalendarClock />
            <span className="tile-next-text"><strong dir="auto">{next.name}</strong> {episodeCode(next.season, next.episode)} · {clockTime(new Date(next.airsAt))}</span>
          </button>
        ) : recent.length ? (
          <span className="tile-latest" dir="auto">Latest · {recent[0].name}</span>
        ) : null}
      </div>
    </Tile>
  );
}
