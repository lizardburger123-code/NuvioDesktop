import { memo } from "react";
import { LuBookmark, LuBookmarkCheck, LuCheck, LuPlay, LuStar, LuX } from "react-icons/lu";
import TiltedCard from "../reactbits/TiltedCard/TiltedCard.jsx";
import { episodeCode, minutesLeft, year } from "../lib/format.js";
import "./Cards.css";

const TILT = {
  rotateAmplitude: 9,
  scaleOnHover: 1.06,
  glare: 0.32,
  shadow: 0.55,
  parallax: 0.6,
  smoothness: 0.55,
  showTooltip: false,
  flipOnClick: false,
  gyroscope: false,
  intro: false,
};

/** Poster with Apple TV style tilt and glare (React Bits TiltedCard). */
export const PosterCard = memo(function PosterCard({ item, onOpen, onToggleLater, saved, width = 168 }) {
  const height = Math.round(width * 1.5);
  return (
    <div className="poster" data-card style={{ width }}>
      <TiltedCard
        {...TILT}
        imageSrc={item.poster}
        altText={item.name}
        containerWidth={width}
        containerHeight={height}
        imageWidth={width}
        imageHeight={height}
        radius={16}
        onClick={() => onOpen(item)}
        captionText={item.name}
      >
        {!item.poster ? <span className="poster-fallback">{item.name}</span> : null}
        {onToggleLater ? (
          <button
            className={`poster-save${saved ? " is-saved" : ""}`}
            aria-label={saved ? `Remove ${item.name} from Watch later` : `Add ${item.name} to Watch later`}
            aria-pressed={saved}
            title={saved ? "In Watch later" : "Watch later"}
            onClick={event => { event.stopPropagation(); onToggleLater(item); }}
            onKeyDown={event => event.stopPropagation()}
          >
            {saved ? <LuBookmarkCheck /> : <LuBookmark />}
          </button>
        ) : null}
      </TiltedCard>
      <div className="poster-text">
        <span className="poster-title" dir="auto">{item.name}</span>
        <span className="poster-meta num">
          {year(item.releaseInfo)}
          {item.imdbRating ? <><LuStar aria-hidden="true" />{item.imdbRating}</> : null}
        </span>
      </div>
    </div>
  );
});

/** Landscape card for continue watching and episodes. */
export const WideCard = memo(function WideCard({ image, logo, title, kicker, meta, progress, watched, onOpen, onRemove, removeLabel, width = 320, badge }) {
  const height = Math.round(width * 9 / 16);
  return (
    <div className="wide" data-card style={{ width }}>
      <TiltedCard
        {...TILT}
        rotateAmplitude={6}
        scaleOnHover={1.04}
        imageSrc={image}
        altText={title}
        containerWidth={width}
        containerHeight={height}
        imageWidth={width}
        imageHeight={height}
        radius={18}
        onClick={onOpen}
        captionText={title}
      >
        <span className="wide-scrim" />
        {logo ? <img className="wide-logo" src={logo} alt="" loading="lazy" decoding="async" /> : null}
        {badge ? <span className="wide-badge">{badge}</span> : null}
        <span className="wide-play" aria-hidden="true"><LuPlay /></span>
        {watched ? <span className="wide-watched" aria-label="Watched"><LuCheck /></span> : null}
        {progress > 0 ? <span className="wide-progress"><span style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }} /></span> : null}
      </TiltedCard>
      {onRemove ? (
        <button className="wide-remove" onClick={event => { event.stopPropagation(); onRemove(); }} aria-label={removeLabel || "Remove"} title={removeLabel || "Remove"}>
          <LuX />
        </button>
      ) : null}
      <div className="wide-text">
        {kicker ? <span className="wide-kicker num">{kicker}</span> : null}
        <span className="wide-title" dir="auto">{title}</span>
        {meta ? <span className="wide-meta num">{meta}</span> : null}
      </div>
    </div>
  );
});

export const ContinueCard = ({ entry, onResume, onRemove }) => (
  <WideCard
    image={entry.thumbnail || entry.backdrop}
    logo={entry.season == null ? entry.logo : null}
    title={entry.season != null ? entry.name : entry.name}
    kicker={entry.season != null ? `${episodeCode(entry.season, entry.episode)}${entry.episodeTitle ? ` · ${entry.episodeTitle}` : ""}` : "Movie"}
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
      <div className="skel" style={{ width, height: Math.round(width * 1.5), borderRadius: 16 }} />
      <div className="skel" style={{ width: width * 0.7, height: 12, marginTop: 12, borderRadius: 6 }} />
    </div>
  ));
