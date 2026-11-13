// Preview-only backend for Search, Library, Trophies and Downloads.
// Return handlers keyed by method name ("area.verb": params => result or a Promise of it).
// ctx.push(topic, data, delayMs) sends a topic to the interface; ctx.base has the handlers of
// backend.js (to wrap one, define the same name here and call ctx.base[name]); ctx.data has the
// preview's catalog.
//
// Test hooks (set from a test script before acting):
//   window.__mockSearch = { delay: { "<query>": ms }, fail: true }   slow or failing searches
//   a search containing "offline" fails like an unreachable addon.
export default ctx => {
  const { push, base, data } = ctx;
  const option = () => window.__mockSearch || {};

  // window.__mockLongLists(n): a list and a trophy shelf of n titles, for long-list checks.
  window.__mockLongLists = (n = 300) => {
    const pool = data.all;
    const day = 86400e3;
    const items = Array.from({ length: n }, (_, i) => {
      const base = pool[i % pool.length];
      return { ...base, id: `${base.id}-${i}`, name: `${base.name} ${i + 1}`, addedAt: Date.now() - i * 3600e3, imdbRating: String((5 + (i * 7) % 50 / 10).toFixed(1)) };
    });
    push("watchLater", items);
    push("completed", items.map((item, i) => ({ id: item.id, type: item.type, name: item.name, poster: item.poster, releaseInfo: item.releaseInfo, completedAt: Date.now() - Math.floor(i / 3) * day * 2, durationMs: 100 * 60e3, episodes: item.type === "series" ? 10 : undefined })));
  };

  // Recent searches, recorded when a search is committed, like the app does.
  let history = [...(base["search.history"]() || [])];
  const record = query => { history = [query, ...history.filter(item => item.toLowerCase() !== query.toLowerCase())].slice(0, 8); };

  // What each addon finds: Cinemeta and AIOMetadata overlap (the same film twice), Kitsu has anime.
  const sectionsFor = q => {
    const hits = data.all.filter(item => item.name.toLowerCase().includes(q) || item.genres.some(g => g.toLowerCase().includes(q)));
    const films = hits.filter(item => item.type === "movie");
    return [
      { key: "cinemeta.movie", title: "Movies", type: "movie", addonName: "Cinemeta", items: films },
      { key: "cinemeta.series", title: "Series", type: "series", addonName: "Cinemeta", items: hits.filter(item => item.type === "series" && !item.id.startsWith("kitsu")) },
      { key: "aio.movie", title: "TMDB Movies", type: "movie", addonName: "AIOMetadata", items: [...films].reverse().slice(0, 3) },
      { key: "kitsu.anime", title: "Anime", type: "anime", addonName: "Anime Kitsu", items: hits.filter(item => item.id.startsWith("kitsu")) },
    ].filter(section => section.items.length);
  };

  // People the preview knows (the cast of every title page, and a few more). The app asks an open
  // film database that only knows exact names; anything else has no works.
  const knownPeople = new Set([...data.cast, "Keanu Reeves", "Rosamund Pike"]);
  const worksOf = name => {
    const pool = [...data.trendingMovies, ...data.trendingSeries, ...data.library];
    const start = [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % pool.length;
    return Array.from({ length: 16 }, (_, i) => pool[(start + i * 3) % pool.length])
      .filter((item, i, list) => list.indexOf(item) === i)
      .map((item, i) => ({ id: item.id, type: item.type, name: item.name, poster: item.poster, releaseInfo: String(2026 - i), role: i === 3 ? "Director" : "" }));
  };

  // Downloads, kept here so every state can be shown: window.__mockDownloads() fills the list with
  // one downloading, one paused, one failed and one finished file.
  let downloads = [{ id: "d1", type: "movie", metaId: "tt9004", videoId: "tt9004", title: "Project Hail Mary", poster: data.library[3].poster, fileName: "Project Hail Mary_2026.mkv", source: "SELection", status: "completed", done: 8.4e9, total: 8.4e9, speed: 0, createdAt: Date.now() - 864e5 }];
  let ticker = 0;
  const publish = () => push("downloads", downloads);
  const tick = () => {
    window.clearInterval(ticker);
    ticker = window.setInterval(() => {
      let live = false;
      downloads = downloads.map(d => {
        if (d.status !== "downloading") return d;
        live = true;
        const speed = (d.rate || 4.2e7) * (0.85 + Math.random() * 0.3);
        const done = Math.min(d.total, d.done + speed / 2);
        return { ...d, done, speed: done >= d.total ? 0 : speed, status: done >= d.total ? "completed" : "downloading" };
      });
      publish();
      if (!live) window.clearInterval(ticker);
    }, 500);
  };
  const setStatus = (id, status) => { downloads = downloads.map(d => (d.id === id ? { ...d, status, speed: 0, error: status === "downloading" ? undefined : d.error } : d)); publish(); if (status === "downloading") tick(); };
  const later = (value, ms = 350) => new Promise(resolve => setTimeout(() => resolve(value), ms));
  // Every download action the interface sent, for tests that check a double click sends one.
  window.__mockDownloadCalls = [];
  const logged = (name, fn) => params => { window.__mockDownloadCalls.push(`${name}:${params.id || ""}`); return fn(params); };
  window.__mockDownloads = () => {
    const ep = data.trendingSeries[4];
    downloads = [
      { id: "d2", type: "series", metaId: ep.id, videoId: `${ep.id}:4:2`, title: ep.name, poster: ep.poster, season: 4, episode: 2, fileName: "Slow.Horses.S04E02.1080p.ATVP.WEB-DL.DDP5.1.H.264-FLUX.mkv", source: "SELection", status: "downloading", done: 1.1e9, total: 3.1e9, speed: 4.2e7, rate: 4.2e7, createdAt: Date.now() - 6e4 },
      { id: "d3", type: "movie", metaId: "tt0010", videoId: "tt0010", title: "Avengers: Doomsday", poster: data.trendingMovies[9].poster, fileName: "Avengers.Doomsday.2026.2160p.WEB-DL.mkv", source: "SELection", status: "paused", done: 6.2e9, total: 22e9, speed: 0, createdAt: Date.now() - 36e5 },
      { id: "d4", type: "series", metaId: "kitsu:46474", videoId: "kitsu:46474:1:3", title: "Frieren: Beyond Journey's End", poster: data.anime[5].poster, season: 1, episode: 3, fileName: "Frieren.S01E03.1080p.mkv", source: "SELection", status: "failed", done: 2.1e8, total: 1.4e9, speed: 0, error: "The link expired before the download finished.", createdAt: Date.now() - 72e5 },
      ...downloads.filter(d => d.id === "d1"),
    ];
    publish();
    tick();
  };

  return {
    "downloads.subscribe": () => { publish(); return true; },
    "downloads.start": ({ streamKey, title, season, episode }) => {
      downloads = [{ id: `d${Date.now()}`, type: "series", metaId: "x", videoId: streamKey, title: title || "Download", season, episode, fileName: `${title || "Download"}.mkv`, source: "SELection", status: "downloading", done: 0, total: 2.4e9, speed: 0, rate: 3.2e8, createdAt: Date.now() }, ...downloads];
      publish();
      tick();
      return { result: "started", folder: "C:\\Users\\you\\Downloads\\Nuvio" };
    },
    "downloads.pause": logged("pause", ({ id }) => later(true).then(value => { setStatus(id, "paused"); return value; })),
    "downloads.resume": logged("resume", ({ id }) => later(true).then(value => { setStatus(id, "downloading"); return value; })),
    "downloads.remove": logged("remove", ({ id }) => later(true).then(value => { downloads = downloads.filter(d => d.id !== id); publish(); return value; })),
    "downloads.reveal": logged("reveal", () => later(true)),
    "downloads.play": logged("play", () => later(true, 500)),

    "search.history": () => history,
    "search.history.remove": ({ query }) => { history = history.filter(item => item !== query); return history; },
    "search.history.clear": () => { history = []; return history; },

    "search.query": ({ query, commit }) => {
      const q = String(query || "").trim();
      if (commit && q.length > 1) record(q);
      if (!q) { push("search", { query: "", loading: false, sections: [] }); return true; }
      const delay = option().delay?.[q] ?? 320;
      push("search", { query: q, loading: true, sections: [] });
      if (option().fail || /offline/i.test(q)) {
        push("search", { query: q, loading: false, sections: [], error: "Cinemeta didn't answer in time." }, delay);
        return true;
      }
      const sections = sectionsFor(q.toLowerCase());
      // Addons answer one by one: the first list comes early, the rest with the final answer.
      if (sections.length > 1) push("search", { query: q, loading: true, sections: sections.slice(0, 1) }, Math.round(delay / 2));
      push("search", { query: q, loading: false, sections }, delay);
      return true;
    },

    "people.works": ({ name }) => new Promise(resolve => setTimeout(() => {
      resolve({ name, items: knownPeople.has(name) ? worksOf(name) : [] });
    }, option().peopleDelay ?? 700)),
  };
};
