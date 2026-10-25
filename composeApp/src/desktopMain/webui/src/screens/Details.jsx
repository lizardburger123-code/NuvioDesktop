import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuBookmark, LuBookmarkCheck, LuClapperboard, LuListVideo, LuPlay, LuStar } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { useScreenActive } from "../lib/screen.js";
import { EASE, reduceMotion } from "../lib/motion.js";
import Row from "../components/Row.jsx";
import { PosterCard, WideCard } from "../components/Cards.jsx";
import Sources from "./Sources.jsx";
import { episodeCode, minutesLeft, year } from "../lib/format.js";
import "./Details.css";

const EMPTY = { loading: true, meta: null };

export default function Details({ params }) {
  const { type, id } = params;
  const key = `${type}:${id}`;
  const { setArt, laterIds, toggleLater, openDetails, toast } = useApp();
  const topic = useTopic("details", EMPTY);
  const state = topic.key === key ? topic : EMPTY;
  const meta = state.meta;
  const [season, setSeason] = useState(params.season ?? null);
  const [sources, setSources] = useState(null);
  const heroRef = useRef(null);
  const active = useScreenActive();

  useEffect(() => { call("details.load", { type, id, name: params.name || "" }).catch(error => toast(error.message, { tone: "error" })); }, [type, id, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  // The title's backdrop becomes the scene while this screen is the one on display.
  useEffect(() => {
    if (!active) return undefined;
    setArt(meta?.background || meta?.banner || null);
    return () => setArt(null);
  }, [active, meta?.background, meta?.banner, setArt]);

  const seasons = useMemo(() => {
    if (!meta?.videos?.length) return [];
    const list = [...new Set(meta.videos.map(video => video.season).filter(s => s != null))].sort((a, b) => (a === 0) - (b === 0) || a - b);
    return list;
  }, [meta]);

  useEffect(() => {
    if (!seasons.length) return;
    if (season == null || !seasons.includes(season)) {
      const resumeSeason = meta?.resume?.season;
      setSeason(seasons.includes(resumeSeason) ? resumeSeason : seasons.find(s => s > 0) ?? seasons[0]);
    }
  }, [seasons, season, meta]);

  const episodes = useMemo(() => (meta?.videos || []).filter(video => video.season === season), [meta, season]);

  // The main button: resume where the user left off, else the first episode / the movie.
  const target = useMemo(() => {
    if (!meta) return null;
    if (meta.type === "movie" || !meta.videos?.length) {
      return { videoId: meta.defaultVideoId || meta.id, label: meta.resume ? "Resume" : "Play", sub: meta.resume ? minutesLeft(meta.resume.positionMs, meta.resume.durationMs) : meta.runtime };
    }
    const resumeVideo = meta.resume && meta.videos.find(video => video.id === meta.resume.videoId);
    const video = resumeVideo || meta.videos.find(v => (v.season || 0) > 0 && !v.watched) || meta.videos[0];
    return {
      videoId: video.id, season: video.season, episode: video.episode, title: video.title, thumbnail: video.thumbnail,
      label: resumeVideo ? "Resume" : "Play", sub: episodeCode(video.season, video.episode),
    };
  }, [meta]);

  // Opened from Continue watching / Spotlight "Play": go straight to the source list.
  useEffect(() => {
    if (!meta || sources) return;
    if (params.sources) {
      const video = meta.videos?.find(v => v.id === params.sources);
      setSources({ videoId: params.sources, season: video?.season ?? params.season, episode: video?.episode ?? params.episode, title: video?.title, thumbnail: video?.thumbnail });
    } else if (params.autoplay && target) {
      setSources(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  // The hero writes itself in once the title has loaded. Each part fades on its own element:
  // fading a wrapper would cut the glass buttons inside it off from the backdrop they blur.
  useLayoutEffect(() => {
    if (!meta || !heroRef.current || reduceMotion()) return undefined;
    const parts = [...heroRef.current.querySelectorAll("[data-rise]")];
    const animations = parts.map((part, i) => part.animate(
      [{ opacity: 0, transform: "translate3d(0, 18px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 640, delay: 60 + i * 55, easing: EASE.out, fill: "backwards" },
    ));
    return () => animations.forEach(animation => animation.cancel());
  }, [meta?.id]);

  const play = async video => {
    try {
      const result = await call("play.resume", { type: meta.type, id: meta.id, videoId: video.videoId, season: video.season, episode: video.episode });
      if (result?.handled) return;
    } catch {
      // fall through to the source list
    }
    setSources(video);
  };

  const saved = laterIds.has(key);

  if (!meta) {
    return (
      <main className="screen details details-loading" aria-busy="true">
        <div className="details-hero">
          <div className="skel" style={{ width: 420, height: 90, borderRadius: 14 }} />
          <div className="skel" style={{ width: 300, height: 16, marginTop: 22 }} />
          <div className="skel" style={{ width: 560, height: 54, marginTop: 14 }} />
          <div className="skel" style={{ width: 230, height: 48, marginTop: 26, borderRadius: 999 }} />
        </div>
        {state.error ? <p className="details-error">{state.error}</p> : null}
      </main>
    );
  }

  const metaLine = [
    year(meta.releaseInfo),
    meta.type === "series" && seasons.filter(s => s > 0).length ? `${seasons.filter(s => s > 0).length} seasons` : null,
    meta.runtime,
    meta.ageRating,
  ].filter(Boolean);

  return (
    <main className="screen details">
      <section className="details-hero" ref={heroRef}>
        {meta.logo ? (
          <img className="details-logo" data-rise src={meta.logo} alt={meta.name} />
        ) : (
          <h1 className="details-title" data-rise dir="auto">{meta.name}</h1>
        )}
        {meta.logo ? <h1 className="sr-only">{meta.name}</h1> : null}
        <div className="details-meta" data-rise>
          {metaLine.map(item => <span key={item}>{item}</span>)}
          {meta.imdbRating ? <span className="details-imdb"><LuStar aria-hidden="true" />{meta.imdbRating}</span> : null}
        </div>
        {meta.genres?.length ? <div className="details-genres" data-rise>{meta.genres.slice(0, 4).join(" · ")}</div> : null}
        {meta.description ? <p className="details-desc" data-rise dir="auto">{meta.description}</p> : null}
        <div className="details-actions">
          <button data-rise className="btn btn-primary details-play" onClick={() => target && play(target)}>
            <LuPlay className="fill" />
            <span>{target?.label}</span>
            {target?.sub ? <span className="details-play-sub num">{target.sub}</span> : null}
          </button>
          <button data-rise className="btn btn-glass" onClick={() => target && setSources(target)}>
            <LuListVideo /> Sources
          </button>
          <button
            data-rise
            className={`btn btn-glass btn-icon${saved ? " is-on" : ""}`}
            onClick={() => toggleLater(meta)}
            aria-pressed={saved}
            aria-label={saved ? "Remove from Watch later" : "Add to Watch later"}
            title={saved ? "In Watch later" : "Watch later"}
          >
            {saved ? <LuBookmarkCheck /> : <LuBookmark />}
          </button>
          {meta.trailers?.length ? (
            <button data-rise className="btn btn-glass btn-icon" aria-label="Trailer" title="Trailer" onClick={() => call("app.openTrailer", { trailer: meta.trailers[0] })}>
              <LuClapperboard />
            </button>
          ) : null}
        </div>
      </section>

      {seasons.length ? (
        <section className="details-episodes">
          <div className="details-seasons glass-flat" role="tablist" aria-label="Seasons">
            {seasons.map(s => (
              <button key={s} role="tab" aria-selected={s === season} onClick={() => setSeason(s)}>
                {s === 0 ? "Specials" : `Season ${s}`}
              </button>
            ))}
          </div>
          <Row title={season === 0 ? "Specials" : `Season ${season}`} subtitle={`${episodes.length} episodes`} key={season}>
            {episodes.map(video => (
              <WideCard
                key={video.id}
                width={300}
                image={video.thumbnail || meta.background}
                title={video.title || `Episode ${video.episode}`}
                kicker={`E${video.episode}${video.runtime ? ` · ${video.runtime}m` : ""}`}
                meta={video.released ? new Date(video.released).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : ""}
                progress={video.progress}
                watched={video.watched}
                badge={video.available === false ? "Upcoming" : null}
                onOpen={() => play({ videoId: video.id, season: video.season, episode: video.episode, title: video.title, thumbnail: video.thumbnail })}
              />
            ))}
          </Row>
        </section>
      ) : null}

      {meta.cast?.length ? (
        <Row title="Cast">
          {meta.cast.slice(0, 20).map(person => (
            <div className="person" key={`${person.name}:${person.role || ""}`}>
              {person.photo ? <img src={person.photo} alt="" loading="lazy" /> : <span className="person-mono">{person.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2)}</span>}
              <span className="person-name" dir="auto">{person.name}</span>
              {person.role ? <span className="person-role" dir="auto">{person.role}</span> : null}
            </div>
          ))}
        </Row>
      ) : null}

      {meta.moreLikeThis?.length ? (
        <Row title="More like this">
          {meta.moreLikeThis.map(item => (
            <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
          ))}
        </Row>
      ) : null}

      <section className="details-facts">
        {[
          ["Status", meta.status],
          ["Released", meta.releaseInfo],
          ["Runtime", meta.runtime],
          ["Director", meta.director?.join(", ")],
          ["Country", meta.country],
          ["Language", meta.language],
        ].filter(([, value]) => value).map(([label, value]) => (
          <div key={label} className="details-fact"><span>{label}</span><strong dir="auto">{value}</strong></div>
        ))}
      </section>
      <div className="screen-end" />

      {sources ? (
        <Sources
          meta={meta}
          video={sources}
          onClose={() => setSources(null)}
        />
      ) : null}
    </main>
  );
}
