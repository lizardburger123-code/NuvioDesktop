import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCalendarClock, LuCheck, LuCheckCheck, LuChevronDown, LuChevronUp, LuClapperboard, LuLayoutGrid, LuList, LuListVideo, LuPlay, LuPlus, LuRotateCcw, LuSearch, LuTrophy,
} from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { useArtColor } from "../lib/artColor.js";
import Row from "../components/Row.jsx";
import { PosterCard, WideCard } from "../components/Cards.jsx";
import TitleMark from "../components/TitleMark.jsx";
import Ratings, { EpisodeScore } from "../components/Ratings.jsx";
import Person from "../components/Person.jsx";
import { reduceMotion } from "../lib/motion.js";
import { year } from "../lib/format.js";
import "./Details.css";

const VIEW_KEY = "nuvio.haze.episodes";
const savedView = () => { try { return window.localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list"; } catch { return "list"; } };
export const seasonName = s => (s === 0 ? "Specials" : `Season ${s}`);
export const airDate = released => (released ? new Date(released).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "");
export const asVideo = video => ({ videoId: video.id, season: video.season, episode: video.episode, title: video.title, thumbnail: video.thumbnail });
/** The topic is pushed again often with the same episodes: compare what is drawn, not identity. */
export const sameEpisode = (a, b) => a === b || ["id", "episode", "title", "thumbnail", "overview", "released", "runtime", "rating", "progress", "watched", "upcoming", "airsAt"].every(field => a[field] === b[field]);
const sameRow = (a, b) => a.fallback === b.fallback && a.next === b.next && a.nextLabel === b.nextLabel && a.onPlay === b.onPlay && a.onMark === b.onMark && sameEpisode(a.video, b.video);
/** The day an episode comes out, as the addon gave it: a bare date is that calendar day wherever you are. */
const airsOn = video => {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(video.released || "").trim());
  return plain ? new Date(+plain[1], plain[2] - 1, +plain[3]) : video.airsAt != null ? new Date(video.airsAt) : null;
};
export const airDay = video => airsOn(video)?.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) || "";
/** How long until it is out, in words: "in 5 hours" (when the time is known), "tomorrow", "in 3 days". */
export const untilAir = video => {
  const day = airsOn(video);
  if (!day) return "";
  const now = new Date();
  if (video.airsAt != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(video.released).trim())) {
    const hours = (video.airsAt - now.getTime()) / 3600e3;
    if (hours < 1) return "in under an hour";
    if (hours < 20) { const h = Math.round(hours); return `in ${h} ${h === 1 ? "hour" : "hours"}`; }
  }
  const days = Math.round((new Date(day).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
};
/** A series still airing: which episode is next and when. */
export function NextEpisode({ video }) {
  if (!video) return null;
  const when = airDay(video);
  return (
    <p className="details-next num" data-rise>
      <LuCalendarClock aria-hidden="true" />
      <b>Next episode</b>
      <span>{`S${video.season} E${video.episode}`}</span>
      {when ? <span>{when}</span> : <span>date not announced</span>}
      {when ? <span className="details-next-when">{untilAir(video)}</span> : null}
    </p>
  );
}
const upcomingTag = video => (video.airsAt != null ? `Airs ${airDay(video)}` : "Not out yet");
const seasonDone = entry => Boolean(entry) && entry.aired > 0 && entry.watched >= entry.aired;

/** A score out of ten as a colour: data, not decoration, so it keeps its own scale in every accent. */
const scoreTone = rating => (rating >= 9 ? "a" : rating >= 8.5 ? "b" : rating >= 8 ? "c" : rating >= 7.5 ? "d" : rating >= 7 ? "e" : rating >= 6 ? "f" : "g");

/** Seen or not, beside the episode (never inside its play button, so it can't start it by accident). */
function WatchedMark({ video, onMark, className }) {
  const name = video.title || `Episode ${video.episode}`;
  return (
    <button
      className={className}
      aria-pressed={Boolean(video.watched)}
      aria-label={`Watched: episode ${video.episode}, ${name}`}
      title={video.watched ? "Mark as unwatched" : "Mark as watched"}
      onClick={() => onMark(video)}
    >
      <span><LuCheck /></span>
    </button>
  );
}

const Episode = memo(function Episode({ video, fallback, next, nextLabel, onPlay, onMark }) {
  const image = video.thumbnail || fallback;
  return (
    <div className={`hz-ep${next ? " is-next" : ""}${video.watched ? " is-watched" : ""}${video.upcoming ? " is-upcoming" : ""}`}>
      <button className="hz-ep-main" onClick={() => onPlay(asVideo(video))} disabled={video.upcoming}>
        <span className="hz-ep-n num">{video.episode}</span>
        <span className="hz-ep-thumb">
          {image ? <img src={image} data-alt={video.thumbnail && fallback ? fallback : undefined} alt="" loading="lazy" decoding="async" /> : null}
          <span className="hz-ep-play" aria-hidden="true"><LuPlay /></span>
          {video.progress > 0 ? <span className="wide-progress"><span style={{ width: `${Math.min(100, Math.round(video.progress * 100))}%` }} /></span> : null}
        </span>
        <span className="hz-ep-text">
          <span className="hz-ep-line">
            <span className="hz-ep-title" dir="auto">{video.title || `Episode ${video.episode}`}</span>
            {next ? <span className="hz-tag is-haze">{nextLabel}</span> : null}
            {video.upcoming ? <span className="hz-tag">{upcomingTag(video)}</span> : null}
          </span>
          {video.overview ? <span className="hz-ep-desc" dir="auto">{video.overview}</span> : null}
          <span className="hz-ep-meta num">
            {airDate(video.released) ? <span>{airDate(video.released)}</span> : null}
            <EpisodeScore value={video.rating} />
            {video.runtime ? <span>{video.runtime} min</span> : null}
          </span>
        </span>
      </button>
      {video.upcoming ? null : <WatchedMark video={video} onMark={onMark} className="hz-ep-mark" />}
    </div>
  );
}, sameRow);

const EpisodeTile = memo(function EpisodeTile({ video, fallback, next, onPlay, onMark }) {
  const image = video.thumbnail || fallback;
  return (
    <div className={`hz-tile${next ? " is-next" : ""}${video.watched ? " is-watched" : ""}`}>
      <button className="hz-tile-main" onClick={() => onPlay(asVideo(video))} disabled={video.upcoming}>
        <span className="hz-ep-thumb">
          {image ? <img src={image} data-alt={video.thumbnail && fallback ? fallback : undefined} alt="" loading="lazy" decoding="async" /> : null}
          <span className="hz-ep-play" aria-hidden="true"><LuPlay /></span>
          {video.progress > 0 ? <span className="wide-progress"><span style={{ width: `${Math.min(100, Math.round(video.progress * 100))}%` }} /></span> : null}
        </span>
        <span className="hz-tile-title" dir="auto"><b className="num">{video.episode}</b>{video.title || `Episode ${video.episode}`}</span>
        {video.upcoming ? <span className="hz-tag hz-tile-tag">{upcomingTag(video)}</span> : null}
        <span className="hz-ep-meta num">
          {airDate(video.released) ? <span>{airDate(video.released)}</span> : null}
          <EpisodeScore value={video.rating} />
          {video.runtime ? <span>{video.runtime} min</span> : null}
        </span>
      </button>
      {video.upcoming ? null : <WatchedMark video={video} onMark={onMark} className="hz-tile-mark" />}
    </div>
  );
}, sameRow);

/** Every episode's score on one sheet: seasons across, episodes down. Click a square to play it. */
function RatingsSheet({ meta, seasons, onPlay }) {
  const real = seasons.filter(s => s > 0);
  const bySeason = useMemo(() => {
    const map = new Map();
    (meta.videos || []).forEach(video => {
      if (!(video.season > 0) || video.episode == null) return;
      if (!map.has(video.season)) map.set(video.season, new Map());
      map.get(video.season).set(video.episode, video);
    });
    return map;
  }, [meta.videos]);
  const most = Math.max(0, ...real.map(s => Math.max(0, ...(bySeason.get(s)?.keys() || []))));
  const average = s => {
    const scores = [...(bySeason.get(s)?.values() || [])].map(v => Number(v.rating)).filter(Boolean);
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  };
  const best = useMemo(() => [...(meta.videos || [])].filter(v => v.season > 0 && v.rating).sort((a, b) => b.rating - a.rating)[0], [meta.videos]);
  return (
    <div className="hz-heat">
      <div className="hz-heat-head">
        <p>Each square is an episode, coloured by its score. Click one to play it.</p>
        {best ? <p className="hz-heat-best">Highest rated: <b>S{best.season} E{best.episode}{best.title ? ` · ${best.title}` : ""}</b> <span className="num">({Number(best.rating).toFixed(1)})</span></p> : null}
      </div>
      <div className="hz-heat-scroll" data-keep-scroll>
        <table className="hz-heat-grid num">
          <thead>
            <tr><th />{real.map(s => <th key={s} scope="col">S{s}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: most }, (_, i) => i + 1).map(episode => (
              <tr key={episode}>
                <th scope="row">E{episode}</th>
                {real.map(s => {
                  const video = bySeason.get(s)?.get(episode);
                  if (!video) return <td key={s}><span className="hz-heat-cell is-none" /></td>;
                  return (
                    <td key={s}>
                      <button
                        className="hz-heat-cell"
                        data-tone={video.rating ? scoreTone(video.rating) : "none"}
                        title={`S${s} E${episode}${video.title ? ` · ${video.title}` : ""}`}
                        aria-label={`Season ${s} episode ${episode}${video.rating ? `, rated ${Number(video.rating).toFixed(1)}` : ""}. Play`}
                        onClick={() => onPlay(asVideo(video))}
                      >
                        {video.rating ? Number(video.rating).toFixed(1) : "–"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row">Avg</th>{real.map(s => { const value = average(s); return <td key={s}><span className="hz-heat-avg">{value ? value.toFixed(1) : "–"}</span></td>; })}</tr>
          </tfoot>
        </table>
      </div>
      <div className="hz-heat-key" aria-hidden="true">
        <span>Lower</span>
        {["g", "f", "e", "d", "c", "b", "a"].map(tone => <i key={tone} data-tone={tone} />)}
        <span>Higher</span>
      </div>
    </div>
  );
}

/** A title's page in the Haze look. The data and the play logic come from Details; this is the furniture. */
export default function HazeDetails({ meta, topic, seasons, season, setSeason, episodes, target, nextAir, similar, stats, onMark, onMarkSeason, play, openSources, saved, heroRef, children }) {
  const { appearance, laterIds, toggleLater, openDetails, toast } = useApp();
  const color = useArtColor([meta.background, meta.banner, meta.poster], appearance?.hazeArt !== false);
  const series = seasons.length > 0;
  const hasRatings = useMemo(() => (meta.videos || []).some(video => video.season > 0 && video.rating), [meta.videos]);
  const tabs = [
    series ? { id: "episodes", label: "Episodes" } : null,
    series && hasRatings ? { id: "ratings", label: "Ratings" } : null,
    meta.cast?.length ? { id: "cast", label: "Cast" } : null,
    { id: "about", label: "Details" },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0].id);
  useEffect(() => { if (!tabs.some(t => t.id === tab)) setTab(tabs[0].id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tabs.length]);
  const [view, setView] = useState(savedView);
  const [query, setQuery] = useState("");
  useEffect(() => { setQuery(""); }, [season]);
  const chooseView = next => { setView(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* a nicety */ } };

  // The episode list folds away: a title opens on what to watch next, with the rest of the page
  // (similar titles, the collection) in reach, and the whole season one click away.
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [meta.id]);
  const expanded = open || query.trim() !== "";
  // The list stays in the page for the length of its closing move, then leaves it.
  const [listed, setListed] = useState(false);
  useEffect(() => {
    if (expanded) { setListed(true); return undefined; }
    const timer = window.setTimeout(() => setListed(false), 380);
    return () => window.clearTimeout(timer);
  }, [expanded]);
  const toggleRef = useRef(null);
  const fold = () => {
    setOpen(false);
    setQuery("");
    toggleRef.current?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
  };
  // Folded, the season shows the episode to watch next: the main button's when it is in this
  // season, else this season's first one not yet seen.
  const lead = episodes.find(video => video.id === target?.videoId) || episodes.find(video => !video.watched && !video.upcoming) || null;
  const progress = stats.get(season) || { total: 0, aired: 0, watched: 0 };
  const done = seasonDone(progress);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return episodes;
    return episodes.filter(video => String(video.episode) === q || (video.title || "").toLowerCase().includes(q));
  }, [episodes, query]);

  const realSeasons = seasons.filter(s => s > 0).length;
  const episodeCount = (meta.videos || []).filter(video => video.season > 0).length;
  const facts = [
    ["Status", meta.status], ["Released", meta.releaseInfo], ["Runtime", meta.runtime],
    ["Director", meta.director?.join(", ")], ["Country", meta.country], ["Language", meta.language],
  ].filter(([, value]) => value);
  const nextLabel = target?.label === "Resume" ? "Continue" : "Up next";

  return (
    <main className="screen details hz-details" style={color ? { "--haze-rgb": color } : undefined}>
      <div className="hz-d-glow" aria-hidden="true" />
      <section className="hz-d-hero" ref={heroRef}>
        <div className="hz-hero-chips" data-rise>
          <span className="hz-tag is-haze">{meta.type === "series" ? "Series" : "Film"}</span>
          {meta.ageRating ? <span className="hz-tag">{meta.ageRating}</span> : null}
          {meta.status ? <span className="hz-tag">{meta.status}</span> : null}
        </div>
        <TitleMark meta={meta} />
        <div className="hz-hero-meta num" data-rise>
          {year(meta.releaseInfo) ? <span>{year(meta.releaseInfo)}</span> : null}
          <Ratings meta={meta} />
          {series && realSeasons ? <span>{realSeasons} {realSeasons === 1 ? "season" : "seasons"}</span> : null}
          {series && episodeCount ? <span>{episodeCount} episodes</span> : null}
          {meta.runtime ? <span>{meta.runtime}</span> : null}
          {(meta.genres || []).slice(0, 3).map(genre => <span key={genre} className="hz-genre">{genre}</span>)}
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
            {saved ? <LuCheck /> : <LuPlus />} {saved ? "In my list" : "My list"}
          </button>
          <button data-rise className="btn btn-glass btn-icon" onClick={() => target && openSources(target)} aria-label="Sources" title="Choose a source"><LuListVideo /></button>
          {meta.type !== "series" ? (
            <button
              data-rise
              className={`btn btn-glass btn-icon${topic.watched ? " is-on" : ""}`}
              onClick={() => call("watched.toggle", { id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, releaseInfo: meta.releaseInfo }).then(on => { if (!on) toast(`${meta.name} taken off the shelf`); }, error => toast(error.message, { tone: "error" }))}
              aria-pressed={Boolean(topic.watched)}
              aria-label={topic.watched ? "Remove from trophies" : "Mark as watched"}
              title={topic.watched ? "On your Trophies shelf" : "Mark as watched"}
            >
              {topic.watched ? <LuTrophy /> : <LuCheck />}
            </button>
          ) : null}
          {meta.trailers?.length ? (
            <button data-rise className="btn btn-glass btn-icon" aria-label="Trailer" title="Trailer" onClick={() => call("app.openTrailer", { trailer: meta.trailers[0] })}><LuClapperboard /></button>
          ) : null}
        </div>
      </section>

      <div className="tabs hz-d-tabs" role="tablist" aria-label="About this title">
        {tabs.map(t => <button key={t.id} role="tab" aria-selected={t.id === tab} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === "episodes" ? (
        <section className="hz-d-panel">
          <div className="hz-ep-tools">
            <div className="hz-seasons" role="tablist" aria-label="Seasons" data-keep-scroll>
              {seasons.map(s => {
                const entry = stats.get(s);
                const complete = seasonDone(entry);
                return (
                  <button key={s} role="tab" className={`chip${s === season ? " on" : ""}`} aria-selected={s === season} onClick={() => { setSeason(s); setOpen(true); }}>
                    {seasonName(s)}
                    {complete ? <LuCheck className="hz-chip-done" aria-hidden="true" /> : entry?.watched ? <span className="hz-chip-count num" aria-hidden="true">{entry.watched}/{entry.aired}</span> : null}
                    {entry?.watched ? <span className="sr-only">{complete ? ", watched" : `, ${entry.watched} of ${entry.aired} watched`}</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="hz-ep-right">
              {progress.aired ? (
                <button className="btn btn-glass btn-sm hz-season-mark" onClick={() => onMarkSeason(season, !done)} aria-label={`Mark all of ${seasonName(season)} as ${done ? "unwatched" : "watched"}`}>
                  {done ? <LuRotateCcw /> : <LuCheckCheck />}<span>{done ? "Mark season unwatched" : "Mark season watched"}</span>
                </button>
              ) : null}
              <label className="hz-find">
                <LuSearch aria-hidden="true" />
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Episode number or name" aria-label="Find an episode" />
              </label>
              <div className="seg" role="group" aria-label="Episode view">
                <button aria-pressed={view === "list"} onClick={() => chooseView("list")} aria-label="List" title="List"><LuList /></button>
                <button aria-pressed={view === "grid"} onClick={() => chooseView("grid")} aria-label="Grid" title="Grid"><LuLayoutGrid /></button>
              </div>
            </div>
          </div>
          <button
            ref={toggleRef}
            className="hz-ep-toggle"
            aria-expanded={expanded}
            aria-controls="hz-ep-list"
            onClick={() => (expanded ? fold() : setOpen(true))}
          >
            <span className="hz-ep-toggle-name">{seasonName(season)}</span>
            <span className="hz-ep-toggle-count num">
              {episodes.length} {episodes.length === 1 ? "episode" : "episodes"}{progress.total > progress.aired ? ` · ${progress.total - progress.aired} to come` : ""}
            </span>
            {progress.watched ? (
              <span className="hz-ep-toggle-seen num">
                <span className="hz-meter" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, progress.watched / Math.max(1, progress.aired))})` }} /></span>
                {done ? "All watched" : `${progress.watched} of ${progress.aired} watched`}
              </span>
            ) : null}
            <span className="hz-ep-toggle-act">{expanded ? "Hide episodes" : "Show all episodes"}</span>
            <LuChevronDown aria-hidden="true" />
          </button>
          {!expanded && lead ? (
            <div className="hz-eps hz-ep-lead">
              <Episode video={lead} fallback={meta.background} next={lead.id === target?.videoId} nextLabel={nextLabel} onPlay={play} onMark={onMark} />
            </div>
          ) : null}
          <div id="hz-ep-list" className="hz-ep-fold" data-open={expanded} inert={expanded ? undefined : ""}>
            <div className="hz-ep-fold-in">
              {listed && shown.length === 0 ? <p className="hz-none">No episode matches “{query}”.</p> : null}
              {!listed ? null : view === "list" ? (
                <div className="hz-eps" key={season}>
                  {shown.map(video => <Episode key={video.id} video={video} fallback={meta.background} next={video.id === target?.videoId} nextLabel={nextLabel} onPlay={play} onMark={onMark} />)}
                </div>
              ) : (
                <div className="hz-tiles" key={season}>
                  {shown.map(video => <EpisodeTile key={video.id} video={video} fallback={meta.background} next={video.id === target?.videoId} onPlay={play} onMark={onMark} />)}
                </div>
              )}
              {listed && shown.length > 5 ? (
                <button className="hz-ep-less" onClick={fold}><LuChevronUp aria-hidden="true" /> Hide episodes</button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "ratings" ? <section className="hz-d-panel"><RatingsSheet meta={meta} seasons={seasons} onPlay={play} /></section> : null}

      {tab === "cast" ? (
        <section className="hz-d-panel"><div className="hz-cast">{meta.cast.slice(0, 40).map(person => <Person key={`${person.name}:${person.role || ""}`} person={person} />)}</div></section>
      ) : null}

      {tab === "about" ? (
        <section className="hz-d-panel">
          <div className="hz-about">
            {meta.description ? <p className="hz-about-text" dir="auto">{meta.description}</p> : null}
            <dl className="hz-facts">
              {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}
              {meta.genres?.length ? <div><dt>Genres</dt><dd>{meta.genres.join(", ")}</dd></div> : null}
            </dl>
          </div>
        </section>
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
        <Row title="You may also like" subtitle={similar.byGenre ? "By genre" : undefined}>
          {similar.items.map(item => (
            <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
          ))}
        </Row>
      ) : null}
      <div className="screen-end" />
      {children}
    </main>
  );
}
