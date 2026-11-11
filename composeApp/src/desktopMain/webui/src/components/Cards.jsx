import { memo } from "react";
import { LuBookmark, LuBookmarkCheck, LuCheck, LuPlay, LuX } from "react-icons/lu";
import { episodeCode, minutesLeft, year } from "../lib/format.js";
import "./Cards.css";

/** A poster: the picture, its name, its year. It lifts a little and takes a white edge on hover. */
export const PosterCard = memo(function PosterCard({ item, onOpen, onToggleLater, saved, width = 168 }) {
  return (
    <div className="poster" data-card style={{ width }}>
      <button className="card-face" data-hero style={{ height: Math.round(width * 1.5) }} onClick={() => onOpen(item)} aria-label={item.name}>
        {item.poster ? <img src={item.poster} alt="" loading="lazy" decoding="async" /> : <span className="poster-fallback" dir="auto">{item.name}</span>}
      </button>
      {onToggleLater ? (
        <button
          className={`poster-save${saved ? " is-saved" : ""}`}
          aria-label={saved ? `Remove ${item.name} from your list` : `Add ${item.name} to your list`}
          aria-pressed={saved}
          title={saved ? "In my list" : "Add to list"}
          onClick={() => onToggleLater(item)}
        >
          {saved ? <LuBookmarkCheck /> : <LuBookmark />}
        </button>
      ) : null}
      <div className="poster-text">
        <span className="poster-title" dir="auto">{item.name}</span>
        <span className="poster-meta num">{[year(item.releaseInfo), item.imdbRating || (item.score ? `${item.score}%` : null)].filter(Boolean).join(" · ")}</span>
      </div>
    </div>
  );
});

/** Landscape card for continue watching and episodes: progress runs along its bottom edge. */
export const WideCard = memo(function WideCard({ image, logo, title, kicker, meta, progress, watched, onOpen, onRemove, removeLabel, width = 300, badge }) {
  return (
    <div className="wide" data-card style={{ width }}>
      <button className="card-face" data-hero style={{ height: Math.round(width * 9 / 16) }} onClick={onOpen} aria-label={title}>
        {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : null}
        <span className="wide-scrim" />
        {logo ? <img className="wide-logo" src={logo} alt="" loading="lazy" decoding="async" /> : null}
        {badge ? <span className="wide-badge">{badge}</span> : null}
        <span className="wide-play" aria-hidden="true"><LuPlay /></span>
        {watched ? <span className="wide-watched" aria-label="Watched"><LuCheck /></span> : null}
        {progress > 0 ? <span className="wide-progress"><span style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }} /></span> : null}
      </button>
      {onRemove ? (
        <button className="wide-remove" onClick={onRemove} aria-label={removeLabel || "Remove"} title={removeLabel || "Remove"}>
          <LuX />
        </button>
      ) : null}
      <div className="wide-text">
        <span className="wide-line">
          <span className="wide-title" dir="auto">{title}</span>
          {meta ? <span className="wide-meta num">{meta}</span> : null}
        </span>
        {kicker ? <span className="wide-kicker num" dir="auto">{kicker}</span> : null}
      </div>
    </div>
  );
});

export const ContinueCard = ({ entry, onResume, onRemove, width }) => (
  <WideCard
    width={width}
    image={entry.thumbnail || entry.backdrop}
    logo={entry.season == null ? entry.logo : null}
    title={entry.name}
    kicker={entry.season != null ? `${episodeCode(entry.season, entry.episode)}${entry.episodeTitle ? ` · ${entry.episodeTitle}` : ""}` : null}
    meta={minutesLeft(entry.positionMs, entry.durationMs)}
    progress={entry.progress}
    onOpen={() => onResume(entry)}
    onRemove={onRemove ? () => onRemove(entry) : undefined}
    removeLabel="Remove from Continue watching"
  />
);

export const SkeletonPosters = ({ count = 8, width = 168 }) =>
  Array.from({ length: count }, (_, i) => (
    <div key={i} className="poster" style={{ width }}>
      <div className="skel" style={{ width, height: Math.round(width * 1.5), borderRadius: 12 }} />
      <div className="skel" style={{ width: width * 0.7, height: 12, borderRadius: 6 }} />
    </div>
  ));
