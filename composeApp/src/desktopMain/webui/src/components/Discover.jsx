import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuLoaderCircle, LuSlidersHorizontal } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { PosterCard, SkeletonPosters } from "./Cards.jsx";
import { EASE, reduceMotion } from "../lib/motion.js";
import { useScreenActive } from "../lib/screen.js";
import "./Discover.css";

const LABELS = { genre: "Genre", year: "Year", rating: "Rating", sort: "Sort", language: "Language", country: "Country", network: "Network", status: "Status" };
const label = name => LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1);
const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } };
const recall = key => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };

/**
 * Every catalog your addons offer for this section, with the filters each one supports
 * (genre, year, rating...), page after page as you scroll.
 */
export default function Discover({ kind }) {
  const { laterIds, toggleLater, openDetails, toast } = useApp();
  const active = useScreenActive();
  const [sources, setSources] = useState(null);
  const [sourceId, setSourceId] = useState(null);
  const [filters, setFilters] = useState({});
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const run = useRef(0);
  const sentinel = useRef(null);
  const gridRef = useRef(null);
  const storeKey = `nuvio.discover.${kind}`;

  useEffect(() => {
    setSources(null);
    call("discover.sources", { kind }).then(list => {
      const all = Array.isArray(list) ? list : [];
      setSources(all);
      const saved = recall(storeKey);
      const start = all.find(s => s.id === saved?.source) || all[0];
      setSourceId(start?.id || null);
      setFilters(start && saved?.source === start.id ? saved.filters || {} : {});
    }, () => setSources([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const source = useMemo(() => sources?.find(s => s.id === sourceId) || null, [sources, sourceId]);
  // Required filters always carry a value (the catalog won't answer without one).
  const effective = useMemo(() => {
    const out = { ...filters };
    source?.filters.forEach(f => { if (f.required && !out[f.name]) out[f.name] = f.options[0]; });
    return out;
  }, [filters, source]);

  const load = reset => {
    if (!source) return;
    const id = ++run.current;
    const skip = reset ? 0 : next;
    if (skip < 0) return;
    setLoading(true);
    setError(null);
    call("discover.page", { source: source.id, filters: effective, skip }, { timeoutMs: 30000 })
      .then(page => {
        if (id !== run.current) return;
        const incoming = page?.items || [];
        setItems(prev => {
          const base = reset ? [] : prev;
          const seen = new Set(base.map(i => `${i.type}:${i.id}`));
          return [...base, ...incoming.filter(i => !seen.has(`${i.type}:${i.id}`))];
        });
        setNext(source.paged && incoming.length ? page.next : -1);
      })
      .catch(err => { if (id === run.current) { setError(err.message); if (!reset) toast(err.message, { tone: "error" }); } })
      .finally(() => { if (id === run.current) setLoading(false); });
  };

  useEffect(() => {
    if (!source) return;
    remember(storeKey, { source: source.id, filters });
    setItems([]);
    setNext(0);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, JSON.stringify(effective)]);

  // Endless grid: the next page loads as the bottom comes near (only while this screen is shown).
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !active) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && !loading && next > 0) load(false);
    }, { rootMargin: "900px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, loading, next, source?.id]);

  // New results settle in; only the first screenful staggers.
  const shown = useRef(0);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (items.length < shown.current || !items.length) shown.current = 0;
    if (!reduceMotion() && shown.current < 18) {
      [...grid.children].slice(shown.current, 18).forEach((node, i) => node.animate(
        [{ opacity: 0, transform: "translate3d(0, 12px, 0)" }, { opacity: 1, transform: "none" }],
        { duration: 380, delay: i * 18, easing: EASE.out, fill: "backwards" },
      ));
    }
    shown.current = items.length;
  }, [items]);

  if (sources && !sources.length) {
    return (
      <section className="discover-empty">
        <h2 className="t-title">Nothing to browse yet</h2>
        <p className="t-meta">None of your addons has a catalog here. Add one from Settings › Addons › Store (The Movie Database, Anime Kitsu, Streaming Catalogs…).</p>
      </section>
    );
  }

  return (
    <section className="discover">
      <div className="discover-sources" role="tablist" aria-label="Catalog">
        {!sources ? Array.from({ length: 6 }, (_, i) => <span key={i} className="discover-source skel" />) : sources.map(s => (
          <button
            key={s.id}
            role="tab"
            className="discover-source"
            aria-pressed={s.id === sourceId}
            onClick={() => { setSourceId(s.id); setFilters({}); }}
            title={`${s.name} · ${s.addon}`}
          >
            <span className="discover-source-name">{s.name}</span>
            <span className="discover-source-addon">{s.addon}</span>
          </button>
        ))}
      </div>

      {source?.filters.length ? (
        <div className="discover-filters">
          <LuSlidersHorizontal className="discover-filters-icon" aria-hidden="true" />
          {source.filters.map(f => (
            <label key={f.name} className={`discover-filter${effective[f.name] ? " is-set" : ""}`}>
              <span>{label(f.name)}</span>
              <select
                className="field"
                value={effective[f.name] || ""}
                onChange={event => setFilters(prev => ({ ...prev, [f.name]: event.target.value }))}
              >
                {!f.required ? <option value="">Any</option> : null}
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
          {Object.values(filters).some(Boolean) ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters({})}>Reset</button>
          ) : null}
        </div>
      ) : null}

      <div ref={gridRef} className="discover-grid">
        {items.map(item => (
          <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
        ))}
      </div>
      {loading && !items.length ? <div className="discover-grid"><SkeletonPosters count={12} /></div> : null}
      {!loading && !items.length && source ? (
        <p className="discover-note">{error || "Nothing matches these filters. Try another genre or year."}</p>
      ) : null}
      <div ref={sentinel} className="discover-more" aria-hidden={!loading}>
        {loading && items.length ? <><LuLoaderCircle className="spin" /> Loading more</> : null}
      </div>
    </section>
  );
}
