import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuArrowLeft, LuBookmark, LuBookmarkCheck, LuCheck, LuClapperboard, LuListVideo, LuPlay, LuRotateCw, LuSearch, LuTrophy } from "react-icons/lu";
import { call, peek } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { back, canGoBack, navigate } from "../lib/router.js";
import { useScreenActive } from "../lib/screen.js";
import { EASE, reduceMotion } from "../lib/motion.js";
import Row from "../components/Row.jsx";
import { PosterCard, WideCard } from "../components/Cards.jsx";
import Sources from "./Sources.jsx";
import TitleMark from "../components/TitleMark.jsx";
import Ratings from "../components/Ratings.jsx";
import Person from "../components/Person.jsx";
import { useSimilar } from "../lib/similar.js";
import HazeDetails from "../haze/Details.jsx";
import { lookOf } from "../lib/look.js";
import { episodeCode, minutesLeft, year } from "../lib/format.js";
import "./Details.css";

const EMPTY = { loading: true, meta: null };
// The app's words when no installed addon can describe a title at all (not a failed load).
const NOT_FOUND = /no addon provides|not found/i;

/**
 * A title's page. The `details` topic carries one title at a time, the one asked for last, so a
 * page kept alive under another title's page holds on to what it last showed: coming back to it
 * never blanks it, and it asks for its title again so what the app pushes is about it once more.
 */
export default function Details({ params }) {
  const { type, id } = params;
  const key = `${type}:${id}`;
  const active = useScreenActive();
  const topic = useTopic("details", EMPTY);
  const own = topic.key === key ? topic : null;
  const kept = useRef(null);
  if (own?.meta) kept.current = own;
  const [failed, setFailed] = useState(null);
  // After "Try again" the old error stays in the topic until the app answers: show loading meanwhile.
  const [retriedFrom, setRetriedFrom] = useState(null);

  const load = useCallback(() => {
    setFailed(null);
    call("details.load", { type, id, name: params.name || "" }).catch(error => setFailed(error.message || "The app didn't answer."));
  }, [type, id, params.name]);

  const asked = useRef(false);
  useEffect(() => {
    if (!active) return;
    if (asked.current && peek("details")?.key === key) return;
    asked.current = true;
    load();
  }, [active, key, load]);

  const state = own?.meta ? own : kept.current;
  if (state) return <TitlePage state={state} params={params} />;
  const missing = Boolean(own) && !own.loading && !own.meta;
  const waiting = retriedFrom !== null && retriedFrom === topic;
  const error = waiting ? null : failed || (missing ? own.error || "" : null);
  return (
    <DetailsStatus
      name={params.name || ""}
      error={error}
      notFound={!failed && missing && (!own.error || NOT_FOUND.test(own.error))}
      onRetry={() => { setRetriedFrom(topic); load(); }}
    />
  );
}

/** While a title loads, or when it can't: the page's frame in the current look, and a way forward. */
function DetailsStatus({ name, error, notFound, onRetry }) {
  const { appearance } = useApp();
  const haze = lookOf(appearance) === "haze";
  const look = haze ? " hz-details" : "";
  const hero = haze ? "hz-d-hero" : "details-hero";
  if (error == null) {
    return (
      <main className={`screen details details-loading${look}`} aria-busy="true">
        <section className={hero}>
          {haze ? (
            <div className="details-skel-row"><span className="skel" style={{ width: 64, height: 28 }} /><span className="skel" style={{ width: 56, height: 28 }} /></div>
          ) : <span className="skel" style={{ width: 220, height: 14 }} />}
          {name ? <h1 className="details-title details-skel-name" dir="auto">{name}</h1> : <div className="skel" style={{ width: 420, maxWidth: "100%", height: 90 }} />}
          <div className="skel" style={{ width: 320, maxWidth: "100%", height: 18 }} />
          <div className="skel" style={{ width: 560, maxWidth: "100%", height: 52 }} />
          <div className="details-skel-row">
            <span className="skel" style={{ width: 190, height: 52 }} />
            <span className="skel" style={{ width: 140, height: 52 }} />
            <span className="skel" style={{ width: 52, height: 52 }} />
          </div>
          <p className="sr-only" role="status">Loading {name || "the title"}</p>
        </section>
        <div className="details-skel-tail">
          <div className="skel" style={{ height: 48 }} />
          <div className="skel" style={{ height: 56, marginTop: 22 }} />
        </div>
      </main>
    );
  }
  const search = name ? () => navigate("search", { q: name }) : null;
  return (
    <main className={`screen details details-problem${look}`}>
      <section className={hero}>
        <h1 className="details-title" dir="auto">{name || (notFound ? "Title not found" : "This title didn't load")}</h1>
        <p className="details-problem-text" role="alert">
          {notFound
            ? "None of your addons can describe this title. Searching by name may find it in another catalog."
            : `${error || "Something went wrong."} Check your connection and addons, then try again.`}
        </p>
        <div className="details-actions">
          {notFound && search ? <button className="btn btn-primary" onClick={search}><LuSearch /> Search for “{name}”</button> : null}
          <button className={`btn ${notFound && search ? "btn-glass" : "btn-primary"}`} onClick={onRetry}><LuRotateCw /> Try again</button>
          {!notFound && search ? <button className="btn btn-glass" onClick={search}><LuSearch /> Search by name</button> : null}
          {canGoBack() ? <button className="btn btn-line" onClick={() => back()}><LuArrowLeft /> Back</button> : null}
        </div>
      </section>
    </main>
  );
}

/** The page itself, drawn from one title's topic; a push for another title leaves it alone. */
const TitlePage = memo(function TitlePage({ state, params }) {
  const meta = state.meta;
  const key = `${params.type}:${params.id}`;
  const { setArt, laterIds, toggleLater, openDetails, toast, appearance } = useApp();
  const [chosen, setSeason] = useState(params.season ?? null);
  const [sources, setSources] = useState(null);
  const similar = useSimilar(meta);
  const heroRef = useRef(null);
  const active = useScreenActive();

  // The title's backdrop becomes the scene while this screen is the one on display.
  useEffect(() => {
    if (!active) return undefined;
    setArt(meta.background || meta.banner || null);
    return () => setArt(null);
  }, [active, meta.background, meta.banner, setArt]);

  // The source list is drawn over everything: it belongs to this page and leaves with it.
  useEffect(() => { if (!active) setSources(null); }, [active]);

  const seasons = useMemo(() => {
    if (!meta.videos?.length) return [];
    return [...new Set(meta.videos.map(video => video.season).filter(s => s != null))].sort((a, b) => (a === 0) - (b === 0) || a - b);
  }, [meta]);

  // The main button: resume where the user left off, else the first episode / the movie.
  const target = useMemo(() => {
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

  // The season on show: the one picked, else the one the main button plays from.
  const season = seasons.includes(chosen) ? chosen
    : seasons.includes(target?.season) ? target.season
      : seasons.find(s => s > 0) ?? seasons[0] ?? null;

  const episodes = useMemo(() => (meta.videos || []).filter(video => video.season === season), [meta, season]);

  // Opened from Continue watching / Spotlight "Play": go straight to the source list, once. The
  // topic is pushed again whenever progress or the list changes; that must not reopen it.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    if (params.sources) {
      const video = meta.videos?.find(v => v.id === params.sources);
      setSources({ videoId: params.sources, season: video?.season ?? params.season, episode: video?.episode ?? params.episode, title: video?.title, thumbnail: video?.thumbnail });
    } else if (params.autoplay && target) {
      setSources(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The hero writes itself in once the title has loaded. Each part fades on its own element:
  // fading a wrapper would cut the glass buttons inside it off from the backdrop they blur.
  useLayoutEffect(() => {
    if (!heroRef.current || reduceMotion()) return undefined;
    const parts = [...heroRef.current.querySelectorAll("[data-rise]")];
    const animations = parts.map((part, i) => part.animate(
      [{ opacity: 0, transform: "translate3d(0, 18px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 640, delay: 60 + i * 55, easing: EASE.out, fill: "backwards" },
    ));
    return () => animations.forEach(animation => animation.cancel());
  }, [meta.id]);

  const play = useCallback(async video => {
    try {
      const result = await call("play.resume", { type: meta.type, id: meta.id, videoId: video.videoId, season: video.season, episode: video.episode });
      if (result?.handled) return;
    } catch {
      // fall through to the source list
    }
    setSources(video);
  }, [meta.type, meta.id]);

  const saved = laterIds.has(key);

  if (lookOf(appearance) === "haze") {
    return (
      <HazeDetails
        meta={meta} topic={state} seasons={seasons} season={season} setSeason={setSeason} episodes={episodes}
        target={target} similar={similar}
        play={play} openSources={setSources} saved={saved} heroRef={heroRef}
      >
        {sources ? <Sources meta={meta} video={sources} onClose={() => setSources(null)} /> : null}
      </HazeDetails>
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
        <span className="details-kicker" data-rise>{[meta.type === "series" ? "Series" : "Film", ...(meta.genres?.slice(0, 3) || [])].join(" · ")}</span>
        <TitleMark meta={meta} />
        <div className="details-meta num" data-rise>
          {metaLine.slice(0, 1).map(item => <span key={item}>{item}</span>)}
          <Ratings meta={meta} />
          {metaLine.slice(1).map(item => <span key={item}>{item}</span>)}
        </div>
        {meta.description ? <p className="details-desc" data-rise dir="auto">{meta.description}</p> : null}
        <div className="details-actions">
          <button data-rise className="btn btn-primary details-play" onClick={() => target && play(target)}>
            <LuPlay className="fill" />
            <span>{target?.label}</span>
            {target?.sub ? <span className="details-play-sub num">{target.sub}</span> : null}
          </button>
          <button data-rise className={`btn btn-glass${saved ? " is-on" : ""}`} onClick={() => toggleLater(meta)} aria-pressed={saved}>
            {saved ? <LuBookmarkCheck /> : <LuBookmark />} {saved ? "In my list" : "Add to list"}
          </button>
          <button data-rise className="btn btn-line" onClick={() => target && setSources(target)}>
            <LuListVideo /> Sources
          </button>
          {meta.type !== "series" ? (
            <button
              data-rise
              className={`btn btn-glass btn-icon${state.watched ? " is-on" : ""}`}
              onClick={() => call("watched.toggle", { id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, releaseInfo: meta.releaseInfo }).then(on => { if (!on) toast(`${meta.name} taken off the shelf`); }, error => toast(error.message, { tone: "error" }))}
              aria-pressed={Boolean(state.watched)}
              aria-label={state.watched ? "Remove from trophies" : "Mark as watched"}
              title={state.watched ? "On your Trophies shelf" : "Mark as watched"}
            >
              {state.watched ? <LuTrophy /> : <LuCheck />}
            </button>
          ) : null}
          {meta.trailers?.length ? (
            <button data-rise className="btn btn-glass btn-icon" aria-label="Trailer" title="Trailer" onClick={() => call("app.openTrailer", { trailer: meta.trailers[0] })}>
              <LuClapperboard />
            </button>
          ) : null}
        </div>
      </section>

      {seasons.length ? (
        <section className="details-episodes">
          <div className="tabs details-seasons" role="tablist" aria-label="Seasons">
            {seasons.map(s => (
              <button key={s} role="tab" aria-selected={s === season} onClick={() => setSeason(s)}>
                {s === 0 ? "Specials" : `Season ${s}`}
              </button>
            ))}
          </div>
          <Row title="Episodes" subtitle={`${season === 0 ? "Specials" : `Season ${season}`} · ${episodes.length}`} key={season}>
            {episodes.map(video => (
              <WideCard
                key={video.id}
                width={300}
                image={video.thumbnail || meta.background}
                fallbackImage={meta.background}
                title={video.title || `Episode ${video.episode}`}
                kicker={`E${video.episode}${video.runtime ? ` · ${video.runtime}m` : ""}`}
                meta={[video.released ? new Date(video.released).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : null, Number(video.rating) > 0 ? `★ ${Number(video.rating).toFixed(1)}` : null].filter(Boolean).join(" · ")}
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
          {meta.cast.slice(0, 20).map(person => <Person key={`${person.name}:${person.role || ""}`} person={person} />)}
        </Row>
      ) : null}

      {meta.collection?.length > 1 ? (
        <Row title={meta.collectionName || "In this series"} subtitle={`${meta.collection.length} films`}>
          {meta.collection.map(item => (
            <WideCard
              key={`${item.type}:${item.id}`}
              width={300}
              image={item.poster || item.banner}
              title={item.name}
              kicker={item.releaseInfo || ""}
              meta={item.id === meta.id || item.name === meta.name ? "Now viewing" : item.imdbRating ? `IMDb ${item.imdbRating}` : ""}
              onOpen={() => (item.id === meta.id ? null : openDetails(item))}
            />
          ))}
        </Row>
      ) : null}

      {similar.items.length ? (
        <Row title="More like this" subtitle={similar.byGenre ? "By genre" : undefined}>
          {similar.items.map(item => (
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
});
