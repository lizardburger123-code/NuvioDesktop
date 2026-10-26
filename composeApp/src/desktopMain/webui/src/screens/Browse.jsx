import { useEffect, useMemo, useRef, useState } from "react";
import { LuInfo, LuPlay } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import Row from "../components/Row.jsx";
import { PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import { navigate } from "../lib/router.js";
import RowActions, { openCatalog } from "../components/RowActions.jsx";
import { useSegmentPill } from "../lib/motion.js";
import Discover from "../components/Discover.jsx";
import { year } from "../lib/format.js";
import "./Browse.css";

const TITLES = { movie: "Movies", series: "Series", anime: "Anime" };

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

  const sections = useMemo(() => home.sections.filter(section => sectionKind(section) === kind), [home.sections, kind]);
  const genres = useMemo(() => {
    const counts = new Map();
    sections.forEach(section => section.items.forEach(item => (item.genres || []).forEach(g => counts.set(g, (counts.get(g) || 0) + 1))));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([g]) => g);
  }, [sections]);
  const filtered = useMemo(() => sections
    .map(section => ({ ...section, items: genre ? section.items.filter(item => item.genres?.includes(genre)) : section.items }))
    .filter(section => section.items.length), [sections, genre]);
  const featured = filtered[0]?.items.find(item => item.banner) || filtered[0]?.items[0];

  return (
    <main className="screen browse">
      <section className="browse-head">
        <h1 className="t-page">{TITLES[kind] || "Browse"}</h1>
        <div ref={modeRef} className="seg glass-flat browse-mode" role="tablist" aria-label="View">
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

      {mode === "discover" ? <Discover kind={kind} /> : null}

      {mode === "highlights" && featured ? (
        <section className="browse-feature" style={{ backgroundImage: `url("${featured.banner || featured.poster}")` }}>
          <div className="browse-feature-scrim" />
          <div className="browse-feature-body">
            {featured.logo ? <img src={featured.logo} alt={featured.name} className="browse-feature-logo" /> : <h2 className="browse-feature-title">{featured.name}</h2>}
            <span className="t-meta">{[year(featured.releaseInfo), featured.genres?.slice(0, 3).join(" · "), featured.imdbRating ? `IMDb ${featured.imdbRating}` : null].filter(Boolean).join("  ·  ")}</span>
            {featured.description ? <p className="browse-feature-desc">{featured.description}</p> : null}
            <div className="browse-feature-actions">
              <button className="btn btn-primary" onClick={() => navigate("details", { type: featured.type, id: featured.id, name: featured.name, autoplay: true })}><LuPlay /> Play</button>
              <button className="btn btn-glass" onClick={() => openDetails(featured)}><LuInfo /> Details</button>
            </div>
          </div>
        </section>
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
        <p className="browse-empty">None of your addons has a {TITLES[kind]?.toLowerCase() || kind} catalog on Home. Turn one on in Settings, or install a catalog addon.</p>
      ) : null}
      <div className="screen-end" />
    </main>
  );
}
