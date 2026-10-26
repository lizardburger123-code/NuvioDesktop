import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import SearchHero from "../components/SearchHero.jsx";
import { PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import { navigate } from "../lib/router.js";
import { useScreenActive } from "../lib/screen.js";
import { loadHistory } from "../lib/searchHistory.js";
import { useSegmentPill } from "../lib/motion.js";
import { LuPuzzle } from "react-icons/lu";
import "./Search.css";

const TYPE_LABELS = { movie: "Movies", series: "Series", anime: "Anime", tv: "TV", channel: "Channels" };
const typeLabel = type => TYPE_LABELS[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : "Other");
const FILTERS = "nuvio.search.filters";
const loadFilters = () => { try { return JSON.parse(localStorage.getItem(FILTERS)) || {}; } catch { return {}; } };

export default function Search({ params }) {
  const { laterIds, toggleLater, openDetails } = useApp();
  const [query, setQuery] = useState(params.q || "");
  const [filters, setFilters] = useState(() => ({ type: "all", addon: "all", ...loadFilters() }));
  const results = useTopic("search", { query: "", loading: false, sections: [] });
  const timer = useRef(0);
  const active = useScreenActive();
  const typeRef = useRef(null);
  useSegmentPill(typeRef);

  const run = (text, { live = false } = {}) => {
    window.clearTimeout(timer.current);
    const go = () => {
      setQuery(text);
      call("search.query", { query: text, commit: !live }).then(() => { if (!live) loadHistory(); }, () => {});
      if (!live) navigate("search", { q: text }, { replace: true });
    };
    if (live) timer.current = window.setTimeout(go, 380);
    else go();
  };

  useEffect(() => {
    if (params.q) run(params.q);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilter = patch => setFilters(current => {
    const next = { ...current, ...patch };
    try { localStorage.setItem(FILTERS, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const current = results.query === query ? results : { loading: Boolean(query), sections: [] };

  // What the results offer to filter by: their kinds and the addons they came from.
  const { types, addons } = useMemo(() => {
    const typeCounts = new Map();
    const addonCounts = new Map();
    current.sections.forEach(section => {
      const n = section.items.length;
      if (!n) return;
      typeCounts.set(section.type, (typeCounts.get(section.type) || 0) + n);
      const addon = section.addonName || "Other";
      addonCounts.set(addon, (addonCounts.get(addon) || 0) + n);
    });
    return { types: [...typeCounts.entries()], addons: [...addonCounts.entries()].sort((a, b) => b[1] - a[1]) };
  }, [current.sections]);

  // A remembered filter that this search doesn't have falls back to everything.
  const typeFilter = filters.type !== "all" && types.some(([t]) => t === filters.type) ? filters.type : "all";
  const addonFilter = filters.addon !== "all" && addons.some(([a]) => a === filters.addon) ? filters.addon : "all";
  const shown = current.sections.filter(section => (typeFilter === "all" || section.type === typeFilter)
    && (addonFilter === "all" || (section.addonName || "Other") === addonFilter));
  const total = current.sections.reduce((sum, section) => sum + section.items.length, 0);
  const shownTotal = shown.reduce((sum, section) => sum + section.items.length, 0);

  const gridRef = useRef(null);
  useLayoutEffect(() => {
    if (!gridRef.current) return;
    gridRef.current.querySelectorAll(".search-group").forEach((node, i) => i < 4 && node.animate(
      [{ opacity: 0, transform: "translate3d(0, 8px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 260, delay: i * 40, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" },
    ));
  }, [typeFilter, addonFilter]);

  return (
    <main className="screen search">
      <section className="search-top">
        <h1 className="t-page">Search</h1>
        <SearchHero autoFocus={active} initial={params.q || ""} onSubmit={run} compact />
        {total ? (
          <div className="search-filters" role="toolbar" aria-label="Filter results">
            {types.length > 1 ? (
              <div ref={typeRef} className="seg glass-flat" role="group" aria-label="Kind">
                <button aria-pressed={typeFilter === "all"} onClick={() => setFilter({ type: "all" })}>All</button>
                {types.map(([type, n]) => (
                  <button key={type} aria-pressed={typeFilter === type} onClick={() => setFilter({ type })}>
                    {typeLabel(type)} <span className="num search-chip-n">{n}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {addons.length > 1 ? (
              <div className="search-addons" role="group" aria-label="Addon">
                <button className="chip" aria-pressed={addonFilter === "all"} onClick={() => setFilter({ addon: "all" })}>All addons</button>
                {addons.map(([addon, n]) => (
                  <button key={addon} className="chip" aria-pressed={addonFilter === addon} onClick={() => setFilter({ addon: addonFilter === addon ? "all" : addon })}>
                    <span dir="auto">{addon}</span> <span className="num search-chip-n">{n}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {query && current.loading && !total ? (
        <section className="search-group"><div className="search-grid"><SkeletonPosters count={7} /></div></section>
      ) : null}

      <div ref={gridRef}>
        {shown.map(section => (
          <section key={section.key} className="search-group">
            <h2 className="t-title">
              {section.title}
              {section.addonName && !section.title?.includes(section.addonName) ? <span className="search-from" dir="auto">{section.addonName}</span> : null}
              <span className="search-count num">{section.items.length}</span>
            </h2>
            <div className="search-grid">
              {section.items.map(item => (
                <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {total && !shownTotal ? (
        <section className="search-none">
          <h2 className="t-title">Nothing with these filters</h2>
          <button className="btn btn-glass btn-sm" onClick={() => setFilter({ type: "all", addon: "all" })}>Show everything</button>
        </section>
      ) : null}

      {query && !current.loading && !total ? (
        <section className="search-none">
          <h2 className="t-title">Nothing for “<span dir="auto">{query}</span>”</h2>
          <p className="t-meta">Try the original title, fewer words, or the Arabic or English name. Search covers the catalogs of your installed addons.</p>
        </section>
      ) : null}

      {query && !current.loading ? (
        <section className="search-more">
          <LuPuzzle aria-hidden="true" />
          <span>Some addons can't be searched from here. Their own catalogs (with their own search) are in <strong>Your addons</strong>.</span>
          <button className="btn btn-glass btn-sm" onClick={() => navigate("addons")}>Browse your addons</button>
        </section>
      ) : null}
      <div className="screen-end" />
    </main>
  );
}
