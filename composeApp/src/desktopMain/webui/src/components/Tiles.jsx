import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EASE, reduceMotion } from "../lib/motion.js";
import { useScreenActive } from "../lib/screen.js";
import { LuBookmark, LuCalendarClock, LuInfo, LuLibrary, LuPlay, LuSkipForward } from "react-icons/lu";
import SpotlightCard from "../reactbits/SpotlightCard/SpotlightCard.jsx";
import { episodeCode, minutesLeft, relativeAir, clockTime, year } from "../lib/format.js";
import { goSection, navigate } from "../lib/router.js";
import "./Tiles.css";

const openDetails = item => navigate("details", { type: item.type, id: item.id, name: item.name });

function Tile({ className = "", children, style, onClick, label }) {
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

export function SpotlightTile({ items = [], onPlay }) {
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
    <Tile className="tile-spotlight" onClick={() => openDetails(item)} label={item.name}>
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

export function ResumeTile({ entry, onResume }) {
  if (!entry) {
    return (
      <Tile className="tile-resume tile-empty">
        <div className="tile-body">
          <span className="tile-kicker">Resume</span>
          <p className="tile-empty-text">Start something and it will wait for you here.</p>
        </div>
      </Tile>
    );
  }
  return (
    <Tile className="tile-resume" style={{ backgroundImage: `url("${entry.thumbnail || entry.backdrop}")` }} onClick={() => onResume(entry)} label={`Resume ${entry.name}`}>
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

export function WatchLaterTile({ items = [] }) {
  const fan = items.slice(0, 3);
  return (
    <Tile className="tile-later" onClick={() => goSection("library", { tab: "later" })} label="Watch later">
      <div className="tile-body">
        <span className="tile-kicker"><LuBookmark /> Watch later</span>
        <span className="tile-count num">{items.length}</span>
        <span className="tile-meta">{items.length === 1 ? "title saved" : "titles saved"}</span>
      </div>
      <div className="tile-fan" aria-hidden="true">
        {fan.map((item, i) => (
          <img key={item.id} src={item.poster} alt="" style={{ "--i": i }} />
        ))}
      </div>
    </Tile>
  );
}

export function UpNextTile({ upcoming = [], libraryCount = 0 }) {
  const next = upcoming[0];
  if (!next) {
    return (
      <Tile className="tile-schedule" onClick={() => goSection("library")} label="Library">
        <div className="tile-body">
          <span className="tile-kicker"><LuLibrary /> Library</span>
          <span className="tile-count num">{libraryCount}</span>
          <span className="tile-meta">saved titles</span>
        </div>
      </Tile>
    );
  }
  const when = new Date(next.airsAt);
  return (
    <Tile className="tile-schedule" onClick={() => openDetails(next)} label={`${next.name} new episode`}>
      <div className="tile-body">
        <span className="tile-kicker"><LuCalendarClock /> New episode</span>
        <h3 className="tile-name tile-name-sm">{next.name}</h3>
        <span className="tile-meta">{episodeCode(next.season, next.episode)}</span>
        <span className="tile-time num">{clockTime(when)}</span>
        <span className="tile-meta">{relativeAir(next.airsAt)}</span>
      </div>
    </Tile>
  );
}
