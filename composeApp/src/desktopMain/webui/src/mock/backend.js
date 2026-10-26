// Preview backend: answers the same bridge methods the desktop app does, with sample data
// shaped like the real payloads. Titles come from the owner's own watch history and home rows.
import { backdrop, logoText, person, poster, still } from "./art.js";

const movie = (id, name, year, extra = {}) => ({
  id, type: "movie", name, releaseInfo: String(year), poster: poster(name), banner: backdrop(name),
  imdbRating: extra.rating || "7.1", genres: extra.genres || ["Drama"], runtime: extra.runtime || "1h 52m",
  description: extra.description || "", logo: logoText(name), ...extra,
});
const series = (id, name, year, extra = {}) => ({
  ...movie(id, name, year, extra), type: "series", runtime: extra.runtime || "48m",
});

const trendingMovies = [
  movie("tt0001", "Clayface", 2026, { genres: ["Horror", "Action"], rating: "6.9" }),
  movie("tt0002", "The Cycle", 2026, { genres: ["Thriller"] }),
  movie("tt0003", "Surviving Hurricane Otis", 2026, { genres: ["Documentary"] }),
  movie("tt0004", "La bola negra", 2026),
  movie("tt0005", "Gajab Raat", 2026, { genres: ["Comedy"] }),
  movie("tt0006", "Spider-Man: Brand New Day", 2026, { genres: ["Action", "Adventure"], rating: "7.8" }),
  movie("tt0007", "Hope", 2026, { genres: ["Sci-Fi"] }),
  movie("tt0008", "Shaun the Sheep: The Beast of Mossy Bottom", 2026, { genres: ["Animation"] }),
  movie("tt0009", "Wildwood", 2026, { genres: ["Animation", "Family"] }),
  movie("tt0010", "Avengers: Doomsday", 2026, { genres: ["Action"], rating: "8.1" }),
];
const trendingSeries = [
  series("tt1001", "Lupin", 2021, { genres: ["Crime", "Mystery"], rating: "7.5" }),
  series("tt1002", "YAGA", 2026),
  series("tt1003", "The Terminal List", 2022, { genres: ["Action", "Thriller"] }),
  series("tt1004", "Cyberpunk: Edgerunners", 2022, { genres: ["Animation", "Sci-Fi"], rating: "8.3" }),
  series("tt5875444", "Slow Horses", 2022, {
    genres: ["Drama", "Thriller"], rating: "8.4", runtime: "46m",
    description: "A dysfunctional team of MI5 agents navigate the espionage world's smoke and mirrors to defend the UK from sinister forces.",
  }),
  series("tt1006", "Final Table", 2026),
  series("tt1007", "MobLand", 2025, { genres: ["Crime", "Drama"], rating: "7.9" }),
  series("tt1008", "Tulsa King", 2022, { genres: ["Crime", "Drama"] }),
  series("tt1009", "Carrie", 2026, { genres: ["Horror"] }),
  series("tt1010", "Crystal Lake", 2026, { genres: ["Horror"] }),
];
const anime = [
  series("kitsu:7442", "Attack on Titan", 2013, { genres: ["Action", "Anime"], rating: "9.1", runtime: "24m" }),
  series("kitsu:1376", "Death Note", 2006, { genres: ["Mystery", "Anime"], rating: "9.0", runtime: "23m" }),
  series("kitsu:11469", "My Hero Academia", 2016, { genres: ["Action", "Anime"] }),
  series("kitsu:10740", "One Punch Man", 2015, { genres: ["Action", "Comedy"] }),
  series("kitsu:12", "One Piece", 1999, { genres: ["Adventure", "Anime"] }),
  series("kitsu:46474", "Frieren: Beyond Journey's End", 2023, { genres: ["Fantasy", "Anime"], rating: "9.3" }),
  series("kitsu:42765", "Jujutsu Kaisen", 2020, { genres: ["Action", "Anime"] }),
  series("kitsu:44042", "Chainsaw Man", 2022, { genres: ["Action", "Anime"] }),
];
const library = [
  movie("tt9001", "The Hunt", 2012, { genres: ["Drama"], rating: "8.3", description: "A teacher lives a lonely life, all the while struggling over his son's custody. His life slowly gets better as he finds love and receives good news from his son, but his new luck is about to be brutally shattered by an innocent little lie." }),
  anime[1],
  movie("tt9003", "The Odyssey", 2026, { genres: ["Adventure"], rating: "8.0" }),
  movie("tt9004", "Project Hail Mary", 2026, { genres: ["Sci-Fi"], rating: "8.5", description: "Science teacher Ryland Grace wakes up on a spaceship light years from home with no recollection of who he is or how he got there." }),
];

const all = [...trendingMovies, ...trendingSeries, ...anime, ...library];
const byKey = new Map(all.map(item => [`${item.type}:${item.id}`, item]));

let watchLater = [trendingSeries[6], library[3], trendingMovies[5], anime[5], trendingSeries[3]].map(item => ({ ...item, addedAt: Date.now() }));

const continueWatching = [
  { item: anime[0], season: 1, episode: 1, episodeTitle: "To You, Two Thousand Years Later", positionMs: 174633, durationMs: 1540967 },
  { item: anime[1], season: 1, episode: 1, episodeTitle: "Rebirth", positionMs: 812000, durationMs: 1380000 },
  { item: library[0], positionMs: 3120000, durationMs: 6900000 },
  { item: trendingSeries[4], season: 1, episode: 1, episodeTitle: "Failure's Contagious", positionMs: 600000, durationMs: 2760000 },
  { item: library[3], positionMs: 2400000, durationMs: 9360000 },
].map(({ item, ...rest }) => ({
  key: `${item.type}:${item.id}:${rest.season || 0}:${rest.episode || 0}`,
  id: item.id, type: item.type, name: item.name, poster: item.poster, backdrop: item.banner, logo: item.logo,
  videoId: rest.season ? `${item.id}:${rest.season}:${rest.episode}` : item.id,
  thumbnail: rest.season ? still(item.name, rest.episode) : item.banner,
  progress: rest.positionMs / rest.durationMs, lastWatched: Date.now() - 3600_000, ...rest,
}));

const sections = [
  { key: "cinemeta.movie.top", title: "Trending movies", subtitle: "Cinemeta", addonName: "Cinemeta", type: "movie", kind: "movie", items: trendingMovies },
  { key: "cinemeta.series.top", title: "Trending series", subtitle: "Cinemeta", addonName: "Cinemeta", type: "series", kind: "series", items: trendingSeries },
  { key: "kitsu.trending", title: "Trending anime", subtitle: "Anime Kitsu", addonName: "Anime Kitsu", type: "series", kind: "anime", items: anime },
  { key: "torbox.library", title: "TorBox library", subtitle: "AIOStreams", addonName: "AIOStreams", type: "other", items: library },
];

let homeRows = [
  { key: "aio:movie:popular", title: "Popular - Movies", addon: "SELection", enabled: true },
  { key: "aio:series:popular", title: "Popular - Series", addon: "SELection", enabled: true },
  { key: "aio:movie:library", title: "TorBox - Library", addon: "SELection", enabled: false },
  { key: "cinemeta:movie:top", title: "Trending movies", addon: "Cinemeta", enabled: true },
];
let torboxConnected = false;
let torboxItems = library.slice(0, 5);
let storeAdult = true;
let storeItems = [
  { key: "Cinemeta", category: "Catalogs", name: "Cinemeta", blurb: "The official catalog and metadata: popular, top rated and new movies and series.", version: "3.0.14", available: true, manifest: "https://v3-cinemeta.strem.io/manifest.json", installed: "https://v3-cinemeta.strem.io/manifest.json" },
  { key: "TMDB", category: "Catalogs", name: "The Movie Database", blurb: "TMDB catalogs, trending lists and rich metadata in your language.", version: "3.1.4", available: true, manifest: "x", configure: "y" },
  { key: "Streaming", category: "Catalogs", name: "Streaming Catalogs", blurb: "What's on Netflix, Disney+, Max, Prime Video, Apple TV+ and more.", version: "1.4.0", available: true, manifest: "x", configure: "y" },
  { key: "AIOMetadata", category: "Catalogs", name: "AIOMetadata", blurb: "One addon for TMDB, TVDB, MAL and Trakt catalogs with full control over metadata.", needsSetup: true, configure: "y" },
  { key: "Kitsu", category: "Anime", name: "Anime Kitsu", blurb: "Anime catalogs and metadata from Kitsu: trending, airing, top rated.", version: "0.0.10", available: true, manifest: "x", installed: "kitsu", enabled: true },
  { key: "Torrentio", category: "Streams", name: "Torrentio", blurb: "The classic torrent source with debrid support.", available: true, manifest: "x", configure: "y" },
  { key: "USA TV", category: "Live TV", name: "USA TV", blurb: "Free live US TV channels.", available: false, manifest: "x" },
  { key: "OS", category: "Subtitles", name: "OpenSubtitles v3", blurb: "The official OpenSubtitles addon.", available: true, manifest: "x" },
  { key: "OnlyPorn", category: "Adult", name: "OnlyPorn", blurb: "Adult videos from several sites, as catalogs and streams.", available: true, manifest: "x", adult: true, installed: "op", enabled: true },
  { key: "4K", category: "Adult", name: "4K Porn TPB", blurb: "4K and 1080p adult torrents, with debrid support.", needsSetup: true, configure: "y", adult: true },
];
let searchHistory = ["the hunt", "fem", "persona", "death", "Slow Horses"];

let appearance = {
  colors: ["#1d2b64", "#6b3fa0", "#e0607e"],
  wallpaper: { mode: "featured", image: null },
  dim: 0.35,
  blur: 0,
  animate: true,
  profileGate: true,
};

let subtitles = {
  languages: ["ar", "en"],
  font: "Cairo",
  size: 14,
  bold: true,
  outline: true,
  color: "#FFFFFF",
  outlineColor: "#000000",
  align: "right",
  splitLines: true,
  autoSync: true,
  askBeforePlay: true,
  providers: {
    opensubtitles: { apiKey: "", username: "", password: "" },
    subdl: { apiKey: "" },
    subsource: { apiKey: "" },
  },
};

const cast = ["Gary Oldman", "Jack Lowden", "Kristin Scott Thomas", "Saskia Reeves", "Jonathan Pryce", "Rosalind Eleazar", "Christopher Chung", "Aimee-Ffion Edwards"];

const slowHorsesEpisodes = {
  1: ["Failure's Contagious", "Work Drinks", "Bad Tradecraft", "Visiting Hours", "Fasciation", "Follies"],
  2: ["Last Stop", "From Upshott With Love", "Cosmonauts", "Drinking Games", "Old Ghosts", "Ticker"],
  3: ["Strange Games", "Negotiating Positions", "Uneasy Lies", "Hard Lessons", "Tipping Point", "Footprints"],
  4: ["Identity Theft", "Grave Danger", "Hello Goodbye", "Returns", "Scars", "Hello Goodbye"],
};

const detailsFor = (type, id) => {
  const base = byKey.get(`${type}:${id}`) || all.find(item => item.id === id) || trendingSeries[4];
  const isSeries = base.type === "series";
  const seasons = isSeries ? (base.id === "tt5875444" ? [1, 2, 3, 4] : [1, 2]) : [];
  const videos = isSeries
    ? seasons.flatMap(season => (slowHorsesEpisodes[season] || ["Pilot", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"]).map((title, i) => ({
      id: `${base.id}:${season}:${i + 1}`, title, season, episode: i + 1, released: `202${season}-04-0${(i % 9) + 1}`,
      thumbnail: still(base.name, season * 10 + i), runtime: 46, rating: 7.5 + ((i * 3) % 10) / 10,
      overview: "River and Sid join forces. A misfired gun has dire consequences.",
      progress: season === 1 && i === 0 ? 0.22 : 0, watched: false,
    })))
    : [];
  return {
    ...base,
    background: base.banner,
    status: isSeries ? "Ongoing" : "Released",
    ageRating: "TV-MA",
    director: isSeries ? [] : ["Thomas Vinterberg"],
    cast: cast.map((name, i) => ({ name, role: ["Jackson Lamb", "River Cartwright", "Diana Taverner", "Catherine Standish", "David Cartwright", "Louisa Guy", "Roddy Ho", "Shirley Dander"][i], photo: person(name) })),
    trailers: [{ key: "trailer1", name: "Official Trailer", site: "YouTube" }],
    moreLikeThis: trendingSeries.filter(item => item.id !== base.id).slice(0, 8),
    videos,
    seasons,
    resume: isSeries ? { videoId: `${base.id}:1:1`, season: 1, episode: 1, positionMs: 600000, durationMs: 2760000 } : null,
  };
};

const streamRows = [
  ["4K", "SELection", "Slow.Horses.S01E01.2160p.ATVP.WEB-DL.DDP5.1.DV.HDR.H.265-FLUX", "18.2 GB", true],
  ["4K", "SELection", "Slow.Horses.S01E01.2160p.WEB-DL.DDP5.1.Atmos.HDR10.HEVC-NTb", "12.9 GB", true],
  ["1080p", "SELection", "Slow.Horses.S01E01.1080p.ATVP.WEB-DL.DDP5.1.H.264-FLUX", "3.1 GB", true],
  ["1080p", "SELection", "Slow.Horses.S01E01.1080p.BluRay.x264-SHORTBREHD", "4.4 GB", false],
  ["720p", "SELection", "Slow.Horses.S01E01.720p.WEB.h264-KOGi", "1.2 GB", false],
];

export const createMockBackend = deliver => {
  const push = (topic, data, delay = 0) => window.setTimeout(() => deliver({ topic, data }), delay);
  const reply = (id, result, delay = 30) => {
    if (!id) return;
    if (result && typeof result.then === "function") {
      result.then(value => deliver({ id, result: value }), error => deliver({ id, error: error.message }));
      return;
    }
    window.setTimeout(() => deliver({ id, result }), delay);
  };

  let homeLoaded = false;
  const pushHome = () => {
    // Like the app: the loading state is only seen once; later subscribes get the data.
    if (!homeLoaded) push("home", { loading: true, hero: [], sections: [] });
    homeLoaded = true;
    push("home", { loading: false, hero: [trendingSeries[4], library[3], anime[5], trendingMovies[9]], sections }, 260);
  };

  const avatarCatalog = ["Nova", "Echo", "Ember", "Moss", "Tide", "Iris", "Quartz", "Dune", "Volt", "Lumen", "Sable", "Coral"].map((name, i) => {
    const hues = [262, 200, 18, 140, 190, 300, 220, 36, 90, 50, 0, 340];
    const h = hues[i];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><radialGradient id="g" cx="35%" cy="30%"><stop offset="0" stop-color="hsl(${h} 90% 72%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 70% 32%)"/></radialGradient></defs><rect width="96" height="96" fill="url(#g)"/><circle cx="48" cy="40" r="17" fill="rgba(255,255,255,.85)"/><path d="M18 92c4-20 18-30 30-30s26 10 30 30" fill="rgba(255,255,255,.85)"/></svg>`;
    return { id: `av${i}`, name, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, category: i < 8 ? "character" : "abstract", color: `hsl(${h} 60% 45%)`, member: i > 9 };
  });

  const handlers = {
    "app.bootstrap": () => ({
      profile: { id: 1, name: "ren amamiya lol", avatar: null },
      profiles: [{ id: 1, name: "ren amamiya lol" }, { id: 2, name: "Sara", color: "#b0476f" }, { id: 3, name: "Kids", color: "#2f8f6b", pin: true }],
      version: "0.1.1008-fork (preview)",
      appearance,
      native: false,
    }),
    "home.subscribe": () => {
      pushHome();
      push("continue", continueWatching, 120);
      push("watchLater", watchLater, 140);
      push("upcoming", [{ id: "tt5875444", type: "series", name: "Slow Horses", season: 5, episode: 2, title: "Episode 2", airsAt: Date.now() + 5.5 * 3600_000, thumbnail: still("Slow Horses", 52) }], 160);
      return true;
    },
    "home.refresh": () => { pushHome(); return true; },
    "search.history": () => searchHistory,
    "discover.sources": ({ kind }) => {
      const genres = ["Action", "Comedy", "Drama", "Horror", "Sci-Fi", "Thriller", "Romance", "Animation"];
      const years = Array.from({ length: 30 }, (_, i) => String(2026 - i));
      const base = kind === "anime"
        ? [["kitsu-trending", "Trending", "Anime Kitsu"], ["kitsu-airing", "Airing now", "Anime Kitsu"], ["kitsu-top", "Top rated", "Anime Kitsu"], ["mal-season", "This season", "Animeo"]]
        : [["tmdb-popular", "Popular", "The Movie Database"], ["tmdb-top", "Top rated", "The Movie Database"], ["tmdb-trending", "Trending", "The Movie Database"], ["netflix", "Netflix", "Streaming Catalogs"], ["disney", "Disney+", "Streaming Catalogs"], ["cinemeta-new", "New", "Cinemeta"]];
      return base.map(([id, name, addon], i) => ({
        id: `mock|${kind}|${id}`, name, addon, type: kind === "anime" ? "anime" : kind, paged: true,
        filters: [{ name: "genre", required: false, options: genres }, ...(i % 2 === 0 ? [{ name: "year", required: false, options: years }] : [])],
      }));
    },
    "discover.page": ({ source, filters = {}, skip = 0 }) => new Promise(resolve => setTimeout(() => {
      const pool = all.filter(item => !filters.genre || item.genres.includes(filters.genre));
      const page = Array.from({ length: 24 }, (_, i) => {
        const item = pool[(skip + i + source.length) % Math.max(1, pool.length)];
        return item ? { ...item, id: `${item.id}-${skip + i}` } : null;
      }).filter(Boolean);
      resolve({ items: skip > 120 ? [] : page, next: skip > 120 ? -1 : skip + page.length });
    }, 500)),
    "home.rows": () => homeRows,
    "home.rows.set": ({ key, enabled }) => { homeRows = homeRows.map(r => (r.key === key ? { ...r, enabled } : r)); return homeRows; },
    "library.cloud": () => new Promise(resolve => setTimeout(() => resolve({ sources: 1, items: torboxItems }), 400)),
    "torbox.summary": () => new Promise(resolve => setTimeout(() => resolve(torboxConnected ? { connected: true, count: torboxItems.length, size: 182e9 } : { connected: false }), 400)),
    "torbox.connect.start": () => ({ deviceCode: "dev", code: "K7Q2PX", url: "https://torbox.app/device", interval: 3 }),
    "torbox.connect.poll": () => { torboxConnected = true; return { status: "connected" }; },
    "torbox.clear": () => new Promise(resolve => setTimeout(() => { const removed = torboxItems.length; torboxItems = []; resolve({ removed, failed: 0 }); }, 1200)),
    "store.list": () => new Promise(resolve => setTimeout(() => resolve({ showAdult: storeAdult, items: storeItems.map(item => ({ ...item, enabled: item.installed ? item.enabled !== false : undefined })) }), 600)),
    "store.setAdult": ({ show }) => { storeAdult = show; let changed = 0; storeItems = storeItems.map(i => (i.adult && i.installed && i.enabled !== show ? (changed++, { ...i, enabled: show }) : i)); return { showAdult: show, changed }; },
    "addons.setEnabled": ({ id, enabled }) => { storeItems = storeItems.map(i => (i.installed === id ? { ...i, enabled } : i)); return true; },
    "search.history.remove": ({ query }) => { searchHistory = searchHistory.filter(item => item !== query); return searchHistory; },
    "search.history.clear": () => { searchHistory = []; return searchHistory; },
    "subtitles.match": ({ query, languages, title }) => new Promise(resolve => setTimeout(() => {
      const filename = "Hannibal.S01E01.Aperitif.1080p.BluRay.x264-DEMAND.mkv";
      const releases = [
        ["Hannibal.S01E01.1080p.BluRay.x264-DEMAND", "ar", "SubDL", 92, 0],
        ["Hannibal.S01E01.720p.BluRay.x264-DEMAND", "ar", "OpenSubtitles", 70, 18400],
        ["Hannibal.S01E01.HDTV.x264-LOL", "ar", "SubSource", 0, 9100],
        ["Hannibal S01E01 WEB-DL NF", "ar", "SubSense", 20, 0],
        ["Hannibal.S01E01.1080p.BluRay.x264-DEMAND", "en", "OpenSubtitles", 92, 52000],
        ["Hannibal.S01E01.HDTV.x264-2HD", "en", "Podnapisi", 5, 3000],
      ].filter(([release]) => !query || release.toLowerCase().includes(String(query).toLowerCase().split(" ")[0]));
      const wanted = languages && languages.length ? languages : ["ar", "en"];
      resolve({
        filename, configured: 3,
        languages: [{ code: "ar", name: "Arabic" }, { code: "en", name: "English" }],
        results: releases.filter(r => wanted.includes(r[1])).map(([release, language, source, match, downloads], i) => ({
          key: `k${i}`, source, addon: source === "SubSense", language, languageName: language === "ar" ? "Arabic" : "English",
          release, downloads, match, matchLabel: match >= 65 ? "Exact release" : match >= 35 ? "Same source" : match >= 15 ? "Close" : undefined, best: i === 0,
        })),
      });
    }, 700)),
    "search.query": ({ query }) => {
      const q = String(query || "").trim().toLowerCase();
      push("search", { query, loading: true, sections: [] });
      const hits = all.filter(item => item.name.toLowerCase().includes(q) || item.genres.some(g => g.toLowerCase().includes(q)));
      const groups = [
        { key: "movies", title: "Movies", type: "movie", items: hits.filter(item => item.type === "movie") },
        { key: "series", title: "Series", type: "series", items: hits.filter(item => item.type === "series" && !item.id.startsWith("kitsu")) },
        { key: "anime", title: "Anime", type: "anime", items: hits.filter(item => item.id.startsWith("kitsu")) },
      ].filter(group => group.items.length);
      push("search", { query, loading: false, sections: groups }, 300);
      return true;
    },
    "details.load": ({ type, id }) => {
      const key = `${type}:${id}`;
      push("details", { key, loading: true, meta: null });
      push("details", { key, loading: false, meta: detailsFor(type, id), watchLater: watchLater.some(item => item.id === id) }, 220);
      return true;
    },
    "streams.load": ({ videoId }) => {
      const key = videoId;
      push("streams", { key, loading: true, groups: [{ addonId: "aio", addonName: "SELection", loading: true, streams: [] }] });
      push("streams", {
        key, loading: false,
        groups: [{
          addonId: "aio", addonName: "SELection", loading: false,
          streams: streamRows.map(([quality, addon, title, size, cached], i) => ({
            key: `${videoId}#${i}`, name: `${quality} ${cached ? "⚡" : ""}`, title, description: `${title}\n💾 ${size}  ⚙️ TorBox`,
            filename: `${title}.mkv`, size, cached, addonName: addon,
          })),
        }, { addonId: "torbox", addonName: "TorBox library", loading: false, streams: [] }],
      }, 700);
      return true;
    },
    "play": params => new Promise(resolve => setTimeout(() => { console.info("play", params); resolve({ ok: true }); }, params.subtitle && params.subtitle !== "none" ? 600 : 50)),
    "play.resume": () => ({ handled: false }),
    "app.openTrailer": () => true,
    "watchLater.toggle": ({ item }) => {
      const exists = watchLater.some(entry => entry.id === item.id);
      watchLater = exists ? watchLater.filter(entry => entry.id !== item.id) : [{ ...item, addedAt: Date.now() }, ...watchLater];
      push("watchLater", watchLater);
      return !exists;
    },
    "library.subscribe": () => { push("library", { items: library, cloud: library.slice(0, 3) }, 120); push("watchLater", watchLater); push("continue", continueWatching); return true; },
    "settings.appearance.get": () => appearance,
    "settings.appearance.set": patch => { appearance = { ...appearance, ...patch }; push("appearance", appearance); return appearance; },
    "settings.subtitles.get": () => subtitles,
    "settings.subtitles.set": patch => { subtitles = { ...subtitles, ...patch }; return subtitles; },
    "addons.list": () => [
      { id: "aio", name: "SELection", description: "AIOStreams · TorBox", version: "2.4.1", logo: null, types: ["movie", "series"], configurable: true },
      { id: "cinemeta", name: "Cinemeta", description: "Official Stremio metadata", version: "3.0.13", logo: null, types: ["movie", "series"] },
      { id: "kitsu", name: "Anime Kitsu", description: "Anime catalogs and metadata", version: "0.0.11", logo: null, types: ["anime"] },
      { id: "subsense", name: "SubSense", description: "Subtitles aggregator", version: "1.6.0", logo: null, types: ["movie", "series"] },
    ],
    "addons.install": ({ url }) => ({ ok: Boolean(url) }),
    "addons.remove": () => ({ ok: true }),
    "legacy.open": ({ page }) => { console.info("legacy", page); return true; },
    "app.log": () => true,
    "app.openUrl": () => true,
    "app.useClassic": () => true,
    "addons.configure": () => true,
    "profiles.switch": () => true,
    "profile.avatars": () => avatarCatalog,
    "profile.setAvatar": ({ avatarId, url, upload }) => {
      const picked = avatarCatalog.find(a => a.id === avatarId);
      return { avatar: upload || url || picked?.url || null, color: picked?.color || "#6b3fa0", local: Boolean(upload) };
    },
    "profile.stats": () => {
      const minutes = [42, 0, 96, 130, 48, 0, 74];
      const letters = ["M", "T", "W", "T", "F", "S", "S"];
      const today = (new Date().getDay() + 6) % 7;
      return {
        inProgress: continueWatching.length,
        finishedThisMonth: 9,
        weekMinutes: minutes.reduce((a, b) => a + b, 0),
        streak: 3,
        days: minutes.map((m, i) => ({ label: letters[(today + 1 + i) % 7], minutes: m, today: i === 6 })),
      };
    },
    "continue.remove": ({ id }) => {
      const index = continueWatching.findIndex(entry => entry.id === id);
      if (index >= 0) continueWatching.splice(index, 1);
      push("continue", [...continueWatching]);
      return true;
    },
    "subtitles.testProvider": ({ provider }) => ({ ok: false, message: `No ${provider} key saved yet` }),
    "settings.playback.get": () => [
      { key: "autoplay", label: "Play the best source automatically", description: "Skip the source list when a cached source matches your quality settings.", type: "toggle", value: false },
      { key: "reuseLastLink", label: "Reuse the last source", description: "Continue watching starts the same file again instantly.", type: "toggle", value: true },
      { key: "nextEpisode", label: "Next episode prompt", type: "toggle", value: true },
      { key: "decoder", label: "Video decoder", type: "select", value: "auto", options: [{ value: "auto", label: "Automatic (GPU)" }, { value: "software", label: "Software" }] },
    ],
    "settings.playback.set": () => true,
  };

  return {
    handle(message) {
      const handler = handlers[message.method];
      if (!handler) {
        if (message.id) window.setTimeout(() => deliver({ id: message.id, error: `Unknown method ${message.method}` }), 10);
        return;
      }
      try {
        reply(message.id, handler(message.params || {}));
      } catch (error) {
        if (message.id) deliver({ id: message.id, error: error.message });
      }
    },
  };
};
