import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowLeft, LuBookmark, LuBookmarkCheck, LuCheck, LuCheckCheck, LuClapperboard, LuListVideo, LuPlay, LuRotateCcw, LuRotateCw, LuSearch, LuTrophy,
} from "react-icons/lu";
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
import HazeDetails, { NextEpisode, RangePicker, airDate, airDay, asVideo, rangeOf, rangesOf, sameEpisode, seasonName } from "../haze/Details.jsx";
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
const NO_MARKS = new Map();
/** Marks of one request, changed (or dropped when the change returns null). */
const withToken = (marks, token, change) => {
  let touched = false;
  const next = new Map();
  marks.forEach((mark, id) => {
    if (mark.token !== token) { next.set(id, mark); return; }
    touched = true;
    const changed = change(mark);
    if (changed) next.set(id, changed);
  });
  return touched ? next : marks;
};

/** An episode in Cinema's row: the picture plays it; the corner mark says (and sets) whether it was seen. */
const EpisodeCard = memo(function EpisodeCard({ video, fallback, onPlay, onMark }) {
  const name = video.title || `Episode ${video.episode}`;
  const image = video.thumbnail || fallback;
  return (
    <div className={`wide ep-card${video.watched ? " is-watched" : ""}`} data-card style={{ width: 300 }}>
      <button className="card-face" data-hero style={{ height: 169 }} onClick={() => onPlay(asVideo(video))} disabled={video.upcoming} aria-label={`Episode ${video.episode}: ${name}`}>
        {image ? <img src={image} data-alt={fallback && fallback !== image ? fallback : undefined} alt="" loading="lazy" decoding="async" /> : null}
        <span className="wide-scrim" />
        {video.upcoming ? <span className="wide-badge">{video.airsAt != null ? `Airs ${airDay(video)}` : "Not out yet"}</span> : null}
        <span className="wide-play" aria-hidden="true"><LuPlay /></span>
        {video.progress > 0 ? <span className="wide-progress"><span style={{ width: `${Math.min(100, Math.round(video.progress * 100))}%` }} /></span> : null}
      </button>
      {video.upcoming ? null : (
        <button
          className="ep-card-mark"
          aria-pressed={Boolean(video.watched)}
          aria-label={`Watched: episode ${video.episode}, ${name}`}
          title={video.watched ? "Mark as unwatched" : "Mark as watched"}
          onClick={() => onMark(video)}
        >
          <span><LuCheck /></span>
        </button>
      )}
      <div className="wide-text">
        <span className="wide-line">
          <span className="wide-title" dir="auto">{name}</span>
          <span className="wide-meta num">{[airDate(video.released), Number(video.rating) > 0 ? `★ ${Number(video.rating).toFixed(1)}` : null].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="wide-kicker num">{`E${video.episode}${video.runtime ? ` · ${video.runtime}m` : ""}`}</span>
      </div>
    </div>
  );
}, (a, b) => a.fallback === b.fallback && a.onPlay === b.onPlay && a.onMark === b.onMark && sameEpisode(a.video, b.video));

/** The page itself, drawn from one title's topic; a push for another title leaves it alone. */
const TitlePage = memo(function TitlePage({ state, params }) {
  const meta = state.meta;
  const key = `${params.type}:${params.id}`;
  const { setArt, laterIds, toggleLater, openDetails, toast, appearance } = useApp();
  const [chosen, setSeason] = useState(params.season ?? null);
  const [sources, setSources] = useState(null);
  // Episodes marked watched or not on this page, shown at once while the app saves them.
  const [marks, setMarks] = useState(NO_MARKS);
  const similar = useSimilar(meta);
  const heroRef = useRef(null);
  const active = useScreenActive();
  const live = useRef(meta);
  live.current = meta;

  // The title's backdrop becomes the scene while this screen is the one on display.
  useEffect(() => {
    if (!active) return undefined;
    setArt(meta.background || meta.banner || null);
    return () => setArt(null);
  }, [active, meta.background, meta.banner, setArt]);

  // The source list is drawn over everything: it belongs to this page and leaves with it.
  useEffect(() => { if (!active) setSources(null); }, [active]);

  // What the app pushes is the truth: a mark goes once a push agrees, or once its request has
  // been answered and a push follows.
  useEffect(() => {
    setMarks(current => {
      if (!current.size) return current;
      const pushed = new Map((meta.videos || []).map(video => [video.id, Boolean(video.watched)]));
      const next = new Map([...current].filter(([id, mark]) => !mark.settled && pushed.get(id) !== mark.on));
      return next.size === current.size ? current : next;
    });
  }, [meta]);

  const videos = useMemo(() => {
    const now = Date.now();
    return (meta.videos || []).map(video => {
      const mark = marks.get(video.id);
      // Not out yet: the addon says so, or its air date is still ahead (a bare date counts from
      // midnight UTC, as the app counts it).
      const at = Date.parse(video.released || "");
      const upcoming = video.available === false || at > now;
      const airsAt = upcoming && Number.isFinite(at) ? at : null;
      // Marking either way clears an episode's progress, as the app does.
      return mark ? { ...video, watched: mark.on, progress: 0, upcoming, airsAt } : { ...video, upcoming, airsAt };
    });
  }, [meta.videos, marks]);
  const listRef = useRef(videos);
  listRef.current = videos;

  const seasons = useMemo(() => {
    if (!videos.length) return [];
    return [...new Set(videos.map(video => video.season).filter(s => s != null))].sort((a, b) => (a === 0) - (b === 0) || a - b);
  }, [videos]);

  // Watched against aired, per season: the fold bar's meter and the season chips.
  const stats = useMemo(() => {
    const map = new Map();
    videos.forEach(video => {
      if (video.season == null) return;
      const entry = map.get(video.season) || { total: 0, aired: 0, watched: 0 };
      entry.total += 1;
      if (!video.upcoming) entry.aired += 1;
      if (video.watched) entry.watched += 1;
      map.set(video.season, entry);
    });
    return map;
  }, [videos]);

  // The main button: resume where the user left off; else the next episode out after the last one
  // seen (or the first one skipped); else, all seen, the first again. Never one not out yet.
  const target = useMemo(() => {
    if (meta.type === "movie" || !videos.length) {
      return { videoId: meta.defaultVideoId || meta.id, label: meta.resume ? "Resume" : "Play", sub: meta.resume ? minutesLeft(meta.resume.positionMs, meta.resume.durationMs) : meta.runtime };
    }
    const pick = (video, label) => ({
      videoId: video.id, season: video.season, episode: video.episode, title: video.title, thumbnail: video.thumbnail,
      label, sub: episodeCode(video.season, video.episode), disabled: video.upcoming,
    });
    const resumeVideo = meta.resume && !marks.has(meta.resume.videoId) && videos.find(video => video.id === meta.resume.videoId && !video.upcoming);
    if (resumeVideo) return pick(resumeVideo, "Resume");
    const order = videos.filter(video => (video.season || 0) > 0).sort((a, b) => a.season - b.season || (a.episode ?? 0) - (b.episode ?? 0));
    let last = -1;
    order.forEach((video, i) => { if (video.watched) last = i; });
    const ready = video => !video.watched && !video.upcoming;
    const next = order.slice(last + 1).find(ready) || order.find(ready);
    if (next) return pick(next, "Play");
    const first = order.find(video => !video.upcoming);
    if (first) return pick(first, last >= 0 ? "Watch again" : "Play");
    return pick(videos[0], "Play");
  }, [meta, videos, marks]);

  // Still airing: the next episode not out yet, the soonest first.
  const nextAir = useMemo(() => {
    const coming = videos.filter(video => (video.season || 0) > 0 && video.upcoming);
    if (!coming.length) return null;
    return coming.reduce((best, video) => ((video.airsAt ?? Infinity) < (best.airsAt ?? Infinity) ? video : best));
  }, [videos]);

  // The season on show: the one picked, else the one the main button plays from.
  const season = seasons.includes(chosen) ? chosen
    : seasons.includes(target?.season) ? target.season
      : seasons.find(s => s > 0) ?? seasons[0] ?? null;

  const episodes = useMemo(() => videos.filter(video => video.season === season), [videos, season]);
  const shownSeason = useRef(season);
  shownSeason.current = season;
  // Cinema's row: a long season a hundred at a time, opening on the hundred with the next episode.
  const [range, setRange] = useState(null);
  useEffect(() => { setRange(null); }, [season]);
  const ranges = useMemo(() => rangesOf(episodes), [episodes]);
  const rangeIndex = ranges ? Math.min(ranges.length - 1, range ?? rangeOf(episodes, target?.videoId)) : 0;
  const rowEpisodes = ranges ? episodes.slice(ranges[rangeIndex].from, ranges[rangeIndex].to) : episodes;

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
    const { type, id } = live.current;
    try {
      const result = await call("play.resume", { type, id, videoId: video.videoId, season: video.season, episode: video.episode });
      if (result?.handled) return;
    } catch {
      // fall through to the source list
    }
    setSources(video);
  }, []);

  /** Episodes watched or not: shown at once, saved by the app, put back with a note if that fails. */
  const markEpisodes = useCallback((list, on, what) => {
    if (!list.length) return Promise.resolve(false);
    const m = live.current;
    const token = {};
    // Marking moves the main button on, often into the next season: the season on show stays put.
    setSeason(picked => picked ?? shownSeason.current);
    setMarks(current => {
      const next = new Map(current);
      list.forEach(video => next.set(video.id, { on, token, settled: false }));
      return next;
    });
    const about = { id: m.id, type: m.type, name: m.name, poster: m.poster, releaseInfo: m.releaseInfo };
    const request = what
      ? call("watched.season", { ...about, season: list[0].season, episodes: list.map(video => ({ season: video.season, episode: video.episode, videoId: video.id })), on })
      : call("watched.episode", { ...about, season: list[0].season, episode: list[0].episode, videoId: list[0].id, on });
    return request.then(
      () => { setMarks(current => withToken(current, token, mark => ({ ...mark, settled: true }))); return true; },
      error => {
        setMarks(current => withToken(current, token, () => null));
        toast(`Couldn't mark ${what || `episode ${list[0].episode}`} as ${on ? "watched" : "unwatched"}. ${error.message}`, { tone: "error" });
        return false;
      },
    );
  }, [toast]);

  const toggleWatched = useCallback(video => { markEpisodes([video], !video.watched); }, [markEpisodes]);

  /** A whole season at once (what hasn't aired stays as it is), with a way to take it back. */
  const markSeason = useCallback((s, on) => {
    const list = listRef.current.filter(video => video.season === s && (on ? !video.watched && !video.upcoming : video.watched));
    const what = seasonName(s);
    markEpisodes(list, on, what).then(done => {
      if (done) toast(`${what} marked as ${on ? "watched" : "unwatched"}`, { action: { label: "Undo", run: () => markEpisodes(list, !on, what) } });
    });
  }, [markEpisodes, toast]);

  const saved = laterIds.has(key);

  if (lookOf(appearance) === "haze") {
    return (
      <HazeDetails
        meta={meta} topic={state} seasons={seasons} season={season} setSeason={setSeason} episodes={episodes}
        target={target} nextAir={nextAir} similar={similar} stats={stats} onMark={toggleWatched} onMarkSeason={markSeason}
        play={play} openSources={setSources} saved={saved} heroRef={heroRef}
      >
        {sources ? <Sources meta={meta} video={sources} onClose={() => setSources(null)} /> : null}
      </HazeDetails>
    );
  }

  const realSeasons = seasons.filter(s => s > 0).length;
  const metaLine = [
    year(meta.releaseInfo),
    meta.type === "series" && realSeasons ? `${realSeasons} ${realSeasons === 1 ? "season" : "seasons"}` : null,
    meta.runtime,
    meta.ageRating,
  ].filter(Boolean);
  const current = stats.get(season) || { total: 0, aired: 0, watched: 0 };
  const seasonDone = current.aired > 0 && current.watched >= current.aired;

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
        <NextEpisode video={nextAir} />
        {meta.description ? <p className="details-desc" data-rise dir="auto">{meta.description}</p> : null}
        <div className="details-actions">
          <button data-rise className="btn btn-primary details-play" onClick={() => target && play(target)} disabled={target?.disabled}>
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
            {seasons.map(s => {
              const st = stats.get(s);
              const done = st && st.aired > 0 && st.watched >= st.aired;
              return (
                <button key={s} role="tab" aria-selected={s === season} onClick={() => setSeason(s)}>
                  {seasonName(s)}
                  {done ? <LuCheck className="details-season-done" aria-hidden="true" /> : st?.watched ? <span className="tabs-count num" aria-hidden="true">{st.watched}/{st.aired}</span> : null}
                  {st?.watched ? <span className="sr-only">{done ? ", watched" : `, ${st.watched} of ${st.aired} watched`}</span> : null}
                </button>
              );
            })}
          </div>
          {ranges ? <RangePicker ranges={ranges} value={rangeIndex} onChange={setRange} className="details-ranges" /> : null}
          <Row
            title="Episodes"
            subtitle={`${seasonName(season)} · ${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"}${current.total > current.aired ? ` · ${current.total - current.aired} to come` : ""}${current.watched ? ` · ${seasonDone ? "all watched" : `${current.watched} watched`}` : ""}`}
            key={`${season}:${rangeIndex}`}
            action={current.aired ? (
              <button className="btn btn-sm btn-line details-season-mark" onClick={() => markSeason(season, !seasonDone)} aria-label={`Mark all of ${seasonName(season)} as ${seasonDone ? "unwatched" : "watched"}`}>
                {seasonDone ? <LuRotateCcw /> : <LuCheckCheck />} {seasonDone ? "Mark season unwatched" : "Mark season watched"}
              </button>
            ) : null}
          >
            {rowEpisodes.map(video => <EpisodeCard key={video.id} video={video} fallback={meta.background} onPlay={play} onMark={toggleWatched} />)}
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
