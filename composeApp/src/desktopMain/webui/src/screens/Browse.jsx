import { useEffect, useMemo, useRef, useState } from "react";
import { LuRotateCw } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import Row from "../components/Row.jsx";
import Showcase from "../components/Showcase.jsx";
import { PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import { navigate } from "../lib/router.js";
import RowActions, { openCatalog } from "../components/RowActions.jsx";
import { useSegmentPill } from "../lib/motion.js";
import Discover from "../components/Discover.jsx";
import { year } from "../lib/format.js";
import "./Browse.css";

const TITLES = { movie: "Movies", series: "Series", anime: "Anime" };

// "Anime Catalogs": AniList and MyAnimeList lists with IMDb ids (so titles open and play like any
// series). Its settings ride in the link: AniList trending, this season and top anime; MyAnimeList
// top airing, popular and top films; search; Cinemeta's episode order.
const ANIME_CATALOGS = "https://1fe84bc728af-stremio-anime-catalogs.baby-beamup.club/%7B%22anilist_trending-now%22%3A%22on%22%2C%22anilist_popular-this-season%22%3A%22on%22%2C%22myanimelist_top-airing%22%3A%22on%22%2C%22myanimelist_popular%22%3A%22on%22%2C%22anilist_top-anime%22%3A%22on%22%2C%22myanimelist_top-movies%22%3A%22on%22%2C%22search%22%3A%22on%22%2C%22cinemeta%22%3A%22on%22%7D/manifest.json";
const isAnimeCatalogs = name => /^\s*anime catalogs\s*$/i.test(name || "");

/** On the Anime tab until it's installed: AniList and MyAnimeList's lists, one click away. */
function AnimeCatalogsOffer() {
  const { toast } = useApp();
  const [state, setState] = useState("checking");
  useEffect(() => {
    call("addons.list").then(list => setState((list || []).some(addon => isAnimeCatalogs(addon.name)) ? "installed" : "offer"), () => setState("offer"));
  }, []);
  if (state === "checking" || state === "installed") return null;
  const install = () => {
    setState("installing");
    call("addons.install", { url: ANIME_CATALOGS }, { timeoutMs: 30000 }).then(
      () => { setState("installed"); toast("Anime Catalogs added. Its rows replace Kitsu's (they're in Settings › Rows)."); },
      error => { setState("offer"); toast(error.message, { tone: "error" }); },
    );
  };
  return (
    <section className="anime-offer" aria-label="Better anime catalogs">
      <div className="anime-offer-text">
        <h2 className="anime-offer-title">Anime from AniList and MyAnimeList</h2>
        <p className="anime-offer-desc">The Anime Catalogs addon brings trending, this season, top airing, popular, top rated and anime films, with search. Titles open and play like any other series.</p>
      </div>
      <button className="btn btn-primary" onClick={install} disabled={state === "installing"}>{state === "installing" ? "Adding…" : "Add Anime Catalogs"}</button>
    </section>
  );
}

export const sectionKind = section => section.kind || (section.type === "movie" ? "movie" : section.type === "series" ? "series" : section.type);

export default function Browse({ params }) {
  const kind = params.kind || "movie";
  const mode = params.mode === "discover" ? "discover" : "highlights";
  const { laterIds, toggleLater, openDetails } = useApp();
  const modeRef = useRef(null);
  useSegmentPill(modeRef);
  const home = useTopic("home", { loading: true, hero: [], sections: [] });
  const [genre, setGenre] = useState(null);

  useEffect(() => { call("home.subscribe").catch(() => {}); }, []);
  useEffect(() => { setGenre(null); }, [kind]);

  // Anime Catalogs' rows come first; Kitsu's (when still shown) last.
  const sections = useMemo(() => {
    const list = home.sections.filter(section => sectionKind(section) === kind);
    if (kind !== "anime") return list;
    const rank = section => (isAnimeCatalogs(section.addonName) ? 0 : /kitsu/i.test(`${section.addonName} ${section.key}`) ? 2 : 1);
    return list.map((section, i) => [section, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([section]) => section);
  }, [home.sections, kind]);
  const genres = useMemo(() => {
    const counts = new Map();
    sections.forEach(section => section.items.forEach(item => (item.genres || []).forEach(g => counts.set(g, (counts.get(g) || 0) + 1))));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([g]) => g);
  }, [sections]);
  const filtered = useMemo(() => sections
    .map(section => ({ ...section, items: genre ? section.items.filter(item => item.genres?.includes(genre)) : section.items }))
    .filter(section => section.items.length), [sections, genre]);
  // The showcase rotates through the first row's titles that have artwork (five at most).
  const featuredList = useMemo(() => (filtered[0]?.items || []).filter(item => item.banner).slice(0, 5), [filtered]);

  return (
    <main className="screen browse">
      <section className="browse-head">
        <h1 className="t-page">{TITLES[kind] || "Browse"}</h1>
        <div ref={modeRef} className="seg browse-mode" role="tablist" aria-label="View">
          <button role="tab" aria-pressed={mode === "highlights"} onClick={() => navigate("browse", { kind }, { replace: true })}>Highlights</button>
          <button role="tab" aria-pressed={mode === "discover"} onClick={() => navigate("browse", { kind, mode: "discover" }, { replace: true })}>Discover</button>
        </div>
        {mode === "highlights" && genres.length ? (
          <div className="browse-genres" role="group" aria-label="Genre">
            <button className="chip" aria-pressed={genre == null} onClick={() => setGenre(null)}>All</button>
            {genres.map(g => <button key={g} className="chip" aria-pressed={genre === g} onClick={() => setGenre(g === genre ? null : g)}>{g}</button>)}
          </div>
        ) : null}
      </section>

      {kind === "anime" && mode === "highlights" ? <AnimeCatalogsOffer /> : null}
      {mode === "discover" ? <Discover kind={kind} /> : null}

      {mode === "highlights" && featuredList.length ? (
        <div className="browse-showcase">
          <Showcase short items={featuredList} onPlay={item => navigate("details", { type: item.type, id: item.id, name: item.name, autoplay: true })} onToggleLater={toggleLater} laterIds={laterIds} />
        </div>
      ) : null}

      {mode === "highlights" && home.loading && !sections.length ? <Row title="Loading"><SkeletonPosters /></Row> : null}
      {mode === "highlights" && filtered.map(section => (
        <Row
          key={section.key}
          title={section.title}
          subtitle={section.addonName}
          action={<RowActions section={section} />}
          onMore={section.source ? () => openCatalog(section) : undefined}
        >
          {section.items.map(item => (
            <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
          ))}
        </Row>
      ))}
      {mode === "highlights" && !home.loading && !sections.length ? (
        home.error ? (
          <div className="browse-empty" role="alert">
            <p>Couldn't load your catalogs. <span dir="auto">{home.error}</span></p>
            <button className="btn btn-glass btn-sm" onClick={() => call("home.refresh").catch(() => {})}><LuRotateCw aria-hidden="true" /> Try again</button>
          </div>
        ) : <p className="browse-empty">None of your addons has a {TITLES[kind]?.toLowerCase() || kind} catalog on Home. Turn one on in Settings, or install a catalog addon.</p>
      ) : null}
      <div className="screen-end" />
    </main>
  );
}
