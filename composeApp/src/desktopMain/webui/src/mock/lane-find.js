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

  return {
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
