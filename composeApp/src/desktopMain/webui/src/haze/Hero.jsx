import { useLayoutEffect, useRef } from "react";
import { LuCheck, LuInfo, LuPlay, LuPlus, LuSparkles, LuStar } from "react-icons/lu";
import { EASE, reduceMotion } from "../lib/motion.js";
import { year } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { useArtColor } from "../lib/artColor.js";
import { useApp } from "../AppContext.jsx";
import { Art, FeaturedPicker, Title, nextEpisodeLabel, useFeatured } from "../components/Showcase.jsx";
import "./Hero.css";

const openDetails = item => navigate("details", { type: item.type, id: item.id, name: item.name, ...(item.season ? { season: item.season } : {}) });

/**
 * Home's first screen in the Haze look: one title at a time, its picture running to the top edge,
 * and everything coloured (the button, the marker, the glow on the floor) in that title's colour.
 */
export default function HazeHero({ items = [], short = false, onPlay, onToggleLater, laterIds }) {
  const { appearance } = useApp();
  const { index, show, held, bind } = useFeatured(items);
  const bodyRef = useRef(null);
  const first = useRef(true);
  const item = items[index];
  const color = useArtColor([item?.banner, item?.poster], appearance?.hazeArt !== false);

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (!bodyRef.current || reduceMotion()) return undefined;
    const animations = [...bodyRef.current.children].map((part, i) => part.animate(
      [{ opacity: 0, transform: "translate3d(0, 10px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 520, delay: 120 + i * 50, easing: EASE.out, fill: "backwards" },
    ));
    return () => animations.forEach(animation => animation.cancel());
  }, [index]);

  if (!item) return <section className={`hz-hero skel${short ? " is-short" : ""}`} aria-hidden="true" />;
  const saved = laterIds?.has(`${item.type}:${item.id}`);
  const rating = item.imdbRating ? { value: item.imdbRating, by: "IMDb" } : item.score ? { value: `${item.score}%`, by: "AniList" } : null;
  const anime = item.anilist != null || item.score != null;
  const kind = anime ? (item.type === "movie" ? "Anime film" : "Anime") : item.type === "series" ? "Series" : "Film";
  const next = nextEpisodeLabel(item);

  return (
    <section
      className={`hz-hero${short ? " is-short" : ""}`}
      aria-roledescription="carousel"
      aria-label="Featured"
      style={color ? { "--haze-rgb": color } : undefined}
      {...bind}
    >
      <Art src={item.banner || item.poster} fallback={item.bannerAlt || item.poster} />
      <div className="hz-hero-scrim" />
      <div className="hz-hero-glow" />
      <div
        className="hz-hero-body showcase-body"
        ref={bodyRef}
        role="group"
        aria-roledescription="slide"
        aria-label={`${index + 1} of ${items.length}: ${item.name}`}
        aria-live={held ? "polite" : "off"}
      >
        <div className="hz-hero-chips">
          <span className="hz-tag is-haze"><LuSparkles aria-hidden="true" /> Featured</span>
          <span className="hz-tag">{kind}</span>
          {next ? <span className="hz-tag">{next}</span> : null}
        </div>
        <Title key={`${item.type}:${item.id}`} item={item} />
        <div className="hz-hero-meta num">
          {rating ? <span className="hz-rating"><LuStar aria-hidden="true" /><b>{rating.value}</b>{rating.by}</span> : null}
          {year(item.releaseInfo) ? <span>{year(item.releaseInfo)}</span> : null}
          {item.runtime ? <span>{item.runtime}</span> : null}
          {(item.genres || []).slice(0, 3).map(genre => <span key={genre} className="hz-genre">{genre}</span>)}
        </div>
        {item.description ? <p className="hz-hero-desc" dir="auto">{item.description}</p> : null}
        <div className="hz-hero-actions">
          <button className="btn btn-primary" onClick={() => onPlay?.(item)} aria-label={`Play ${item.name}`}><LuPlay className="fill" /> Play</button>
          <button className={`btn btn-glass${saved ? " is-on" : ""}`} onClick={() => onToggleLater?.(item)} aria-label={saved ? `Remove ${item.name} from My list` : `Add ${item.name} to My list`}>
            {saved ? <LuCheck /> : <LuPlus />} {saved ? "In my list" : "My list"}
          </button>
          <button className="btn btn-glass btn-icon" onClick={() => openDetails(item)} aria-label={`About ${item.name}`} title="Details"><LuInfo /></button>
        </div>
      </div>
      <FeaturedPicker className="hz-hero-dots" items={items} index={index} onPick={show} />
    </section>
  );
}
