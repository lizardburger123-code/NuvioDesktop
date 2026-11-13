// Preview-only backend for the title page and the person page.
// Return handlers keyed by method name ("area.verb": params => result or a Promise of it).
// ctx.push(topic, data, delayMs) sends a topic to the interface; ctx.base has the handlers of
// backend.js (to wrap one, define the same name here and call ctx.base[name]); ctx.data has the
// preview's catalog.
//
// The title page's `details` topic is built here, so it can carry what the page marks:
//   series:tt-missing   no addon has it ("title not found")
//   series:tt-flaky     fails the first time, loads on "Try again"
//   Slow Horses         still airing: Season 5 has one episode out, the next in a few hours
//   One Piece           1,151 episodes in one season, seen up to 1,042, the last not out yet
// window.__mockFailWatched(n) makes the next n watched.episode / watched.season calls fail.
import { still } from "./art.js";

const DAY = 864e5;
/** Slow Horses' fifth season, airing: one episode out, the next tonight, then one a week. */
const airing = meta => {
  if (meta.id !== "tt5875444") return meta;
  const now = Date.now();
  const titles = ["Missing Persons", "Bad Actors", "Quiet Hours", "Old Habits", "Clean Sweep", "Last Orders"];
  const fifth = titles.map((title, i) => {
    const at = i === 0 ? now - 6.5 * DAY : now + 5.5 * 3600e3 + (i - 1) * 7 * DAY;
    return {
      id: `tt5875444:5:${i + 1}`, title, season: 5, episode: i + 1, runtime: 47, thumbnail: still(meta.name, 50 + i),
      // The next one has its exact time; later ones only a date, as addons often give.
      released: i <= 1 ? new Date(at).toISOString() : new Date(at).toISOString().slice(0, 10),
      ...(i === 1 ? { available: false } : {}),
      ...(i === 0 ? { rating: 8.2, overview: "Lamb finds a missing agent in the last place anyone looked." } : {}),
      progress: 0, watched: false,
    };
  });
  return { ...meta, videos: [...meta.videos, ...fifth] };
};

/** A long-running anime as Kitsu lists it: one season of over a thousand weekly episodes. */
let stills = null;
const longRun = meta => {
  if (meta.id !== "kitsu:12") return meta;
  stills = stills || Array.from({ length: 24 }, (_, i) => still(meta.name, i));
  const total = 1151;
  const now = Date.now();
  const named = { 1: "I'm Luffy! The Man Who Will Become King of the Pirates", 1043: "Rising Above the Clouds", 1150: "Morning Light Over the Harbour" };
  const videos = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const at = n === total ? now + 2 * DAY : now - (total - 1 - n) * 7 * DAY - DAY;
    return {
      id: `kitsu:12:1:${n}`, title: named[n] || `Episode ${n}`, season: 1, episode: n, runtime: 24,
      released: new Date(at).toISOString(), thumbnail: n % 9 === 0 ? undefined : stills[n % 24],
      progress: n === 1043 ? 0.35 : 0, watched: n <= 1042,
    };
  });
  return { ...meta, videos, status: "Ongoing", resume: { videoId: "kitsu:12:1:1043", season: 1, episode: 1043, positionMs: 504000, durationMs: 1440000 } };
};

export default ctx => {
  const { push, base, data } = ctx;
  let current = null;
  const films = new Map();
  const failOnce = new Set(["tt-flaky"]);
  // Episodes marked from the page, per title: videoId -> watched.
  const marks = new Map();
  let failNext = 0;
  window.__mockFailWatched = (n = 1) => { failNext = n; };

  const aired = video => video.available !== false && !(Date.parse(video.released || "") > Date.now());

  const withMarks = meta => {
    const own = marks.get(meta.id);
    if (!own || !meta.videos) return meta;
    // Like the app: marking an episode either way clears its progress.
    const videos = meta.videos.map(video => (own.has(video.id) ? { ...video, watched: own.get(video.id), progress: 0 } : video));
    return { ...meta, videos, resume: meta.resume && own.has(meta.resume.videoId) ? null : meta.resume };
  };

  const build = (type, id) => {
    if (id === "tt-missing") return { error: "No addon provides meta for this content." };
    if (failOnce.delete(id)) return { error: "Could not load details from any addon." };
    if (id === "tt-flaky") return { meta: { ...data.detailsFor("movie", "tt0002"), id, name: "The Cycle" } };
    return { meta: withMarks(longRun(airing(data.detailsFor(type, id)))) };
  };

  const send = (type, id, delay) => {
    const result = build(type, id);
    push("details", { key: `${type}:${id}`, loading: false, meta: null, ...result, watched: films.get(id) || false }, delay);
  };

  // Answers like the app: a moment later, after the topic has been pushed again.
  const later = (work, ms = 380) => new Promise((resolve, reject) => window.setTimeout(() => {
    if (failNext > 0) { failNext -= 1; reject(new Error("Your library couldn't be saved.")); return; }
    try { resolve(work()); } catch (error) { reject(error); }
  }, ms));

  const openMeta = id => {
    const meta = current && build(current.type, current.id).meta;
    if (!meta || meta.id !== id) throw new Error("Open the title's page first.");
    return meta;
  };
  const mark = (meta, videos, on) => {
    if (!marks.has(meta.id)) marks.set(meta.id, new Map());
    videos.forEach(video => marks.get(meta.id).set(video.id, on));
    send(current.type, current.id, 0);
  };

  return {
    "details.load": ({ type, id }) => {
      current = { type, id };
      push("details", { key: `${type}:${id}`, loading: true, meta: null });
      send(type, id, id === "tt-missing" || id === "tt-flaky" ? 700 : 220);
      return true;
    },
    // Films: the Trophies shelf. The base keeps the shelf; the topic is this file's.
    "watched.toggle": params => {
      const on = base["watched.toggle"](params);
      films.set(params.id, on);
      if (current) send(current.type, current.id, 0);
      return on;
    },
    "watched.episode": ({ id, videoId, season, episode, on }) => later(() => {
      const meta = openMeta(id);
      const video = meta.videos.find(v => v.id === videoId) || meta.videos.find(v => v.season === season && v.episode === episode);
      if (!video) throw new Error("That episode isn't part of this title.");
      const next = on ?? !video.watched;
      mark(meta, [video], next);
      return next;
    }),
    "watched.season": ({ id, season, episodes, on = true }) => later(() => {
      const meta = openMeta(id);
      const listed = (episodes || []).map(entry => meta.videos.find(v => v.id === entry.videoId) || meta.videos.find(v => v.season === entry.season && v.episode === entry.episode)).filter(Boolean);
      const chosen = (listed.length ? listed : meta.videos.filter(v => v.season === season)).filter(v => !on || aired(v));
      mark(meta, chosen, on);
      return on;
    }),
  };
};
