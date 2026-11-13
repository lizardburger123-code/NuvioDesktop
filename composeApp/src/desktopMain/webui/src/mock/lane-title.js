// Preview-only backend for the title page and the person page.
// Return handlers keyed by method name ("area.verb": params => result or a Promise of it).
// ctx.push(topic, data, delayMs) sends a topic to the interface; ctx.base has the handlers of
// backend.js (to wrap one, define the same name here and call ctx.base[name]); ctx.data has the
// preview's catalog.
//
// The title page's `details` topic is built here, so it can carry what the page marks:
//   series:tt-missing   no addon has it ("title not found")
//   series:tt-flaky     fails the first time, loads on "Try again"
// window.__mockFailWatched(n) makes the next n watched.episode / watched.season calls fail.
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
    return { meta: withMarks(data.detailsFor(type, id)) };
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
