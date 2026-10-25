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

const searchHistory = ["the hunt", "fem", "persona", "death", "Slow Horses"];

let appearance = {
  colors: ["#1d2b64", "#6b3fa0", "#e0607e"],
  wallpaper: { mode: "featured", image: null },
  dim: 0.35,
  blur: 0,
  animate: true,
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
  const reply = (id, result, delay = 30) => { if (id) window.setTimeout(() => deliver({ id, result }), delay); };

  const pushHome = () => {
    push("home", { loading: true, hero: [], sections: [] });
    push("home", { loading: false, hero: [trendingSeries[4], library[3], anime[5], trendingMovies[9]], sections }, 260);
  };

  const handlers = {
    "app.bootstrap": () => ({
      profile: { id: 1, name: "ren amamiya lol", avatar: null },
      profiles: [{ id: 1, name: "ren amamiya lol" }],
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
    "play": params => { console.info("play", params); return { ok: true }; },
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
