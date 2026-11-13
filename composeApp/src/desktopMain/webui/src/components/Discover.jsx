import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuLoaderCircle, LuRotateCw, LuSearch, LuSlidersHorizontal, LuX } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { PosterCard, SkeletonPosters } from "./Cards.jsx";
import { useToggleLater } from "./RowActions.jsx";
import { EASE, reduceMotion } from "../lib/motion.js";
import { useScreenActive } from "../lib/screen.js";
import "./Discover.css";

const LABELS = { genre: "Genre", year: "Year", rating: "Rating", sort: "Sort", language: "Language", country: "Country", network: "Network", status: "Status" };
const label = name => LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1);
export const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } };
export const recall = key => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };

/**
 * One catalog as an endless grid: its own filters (genre, year, rating...), a search box when
 * the catalog can search, and the next page loading as the end comes into view.
 */
export function CatalogGrid({ source, filters, onFilters, emptyText }) {
  const { laterIds, openDetails } = useApp();
  const toggleLater = useToggleLater();
  const active = useScreenActive();
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [text, setText] = useState(filters?.search || "");
  const run = useRef(0);
  // Set as a page is asked for, before React re-renders: the end of the grid can come into
  // view twice in that gap, and the same page must not be fetched twice.
  const busy = useRef(false);
  const seen = useRef(new Set());
  const sentinel = useRef(null);
  const gridRef = useRef(null);

  // Required filters always carry a value (the catalog won't answer without one).
  const effective = useMemo(() => {
    const out = { ...(filters || {}) };
    source?.filters.forEach(f => { if (f.required && !out[f.name]) out[f.name] = f.options[0]; });
    if (!out.search) delete out.search;
    return out;
  }, [filters, source]);
  const waitingForQuery = Boolean(source?.searchOnly && !effective.search);

  // Search as you type (debounced) for catalogs that can search.
  useEffect(() => { setText(filters?.search || ""); }, [source?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!source?.searchable) return undefined;
    const value = text.trim();
    if (value === (filters?.search || "")) return undefined;
    const timer = window.setTimeout(() => onFilters({ ...(filters || {}), search: value }), 420);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const load = reset => {
    if (!source || waitingForQuery) return;
    if (!reset && busy.current) return;
    const id = ++run.current;
    const skip = reset ? 0 : next;
    if (skip < 0) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    call("discover.page", { source: source.id, filters: effective, skip }, { timeoutMs: 30000 })
      .then(page => {
        if (id !== run.current) return;
        if (reset) seen.current = new Set();
        const fresh = (page?.items || []).filter(item => {
          const key = `${item.type}:${item.id}`;
          if (seen.current.has(key)) return false;
          seen.current.add(key);
          return true;
        });
        setItems(prev => (reset ? fresh : [...prev, ...fresh]));
        // A page with nothing new is the end, even when the catalog offers another: some addons
        // ignore the offset and send their first page again, which would otherwise never stop.
        const after = Number(page?.next);
        setNext(source.paged && fresh.length && after > skip ? after : -1);
      })
      .catch(err => {
        if (id !== run.current) return;
        // The bridge's own timeout names the method; say it in words.
        setError(!err?.message || / timed out$/.test(err.message) ? "It took too long to answer." : err.message);
      })
      .finally(() => {
        if (id !== run.current) return;
        busy.current = false;
        setLoading(false);
      });
  };

  useEffect(() => {
    run.current += 1;
    busy.current = false;
    seen.current = new Set();
    setItems([]);
    setNext(0);
    setLoading(false);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, JSON.stringify(effective)]);

  // Endless grid: the next page loads as the bottom comes near (only while this screen is shown).
  // After a failed page it waits for "Try again" instead of asking again by itself.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !active || loading || error || next <= 0) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) load(false);
    }, { rootMargin: "900px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, loading, error, next, source?.id]);

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

  const setOne = (name, value) => onFilters({ ...(filters || {}), [name]: value });
  const anySet = Object.entries(filters || {}).some(([k, v]) => k !== "search" && v);

  return (
    <>
      {source && (source.filters.length || source.searchable) ? (
        <div className="discover-filters">
          {source.searchable ? (
            <label className="discover-search">
              <LuSearch aria-hidden="true" />
              <input
                value={text}
                onChange={event => setText(event.target.value)}
                placeholder={`Search ${source.addon || "this catalog"}`}
                spellCheck={false}
                aria-label={`Search ${source.name}`}
              />
              {text ? <button className="discover-search-clear" onClick={() => setText("")} aria-label="Clear search"><LuX /></button> : null}
            </label>
          ) : null}
          {source.filters.length ? <LuSlidersHorizontal className="discover-filters-icon" aria-hidden="true" /> : null}
          {source.filters.map(f => (
            <label key={f.name} className={`discover-filter${effective[f.name] ? " is-set" : ""}`}>
              <span>{label(f.name)}</span>
              <select className="field" value={effective[f.name] || ""} onChange={event => setOne(f.name, event.target.value)}>
                {!f.required ? <option value="">Any</option> : null}
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
          {anySet ? <button className="btn btn-ghost btn-sm" onClick={() => onFilters(filters?.search ? { search: filters.search } : {})}>Reset</button> : null}
        </div>
      ) : null}

      <div ref={gridRef} className="discover-grid">
        {items.map(item => (
          <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
        ))}
      </div>
      {loading && !items.length ? <div className="discover-grid"><SkeletonPosters count={12} /></div> : null}
      {waitingForQuery ? <p className="discover-note">This catalog only answers searches. Type what you're looking for above.</p> : null}
      {!loading && !items.length && source && !waitingForQuery ? (
        error ? (
          <div className="discover-note discover-failed" role="alert">
            <p>Couldn't load this catalog. {error}</p>
            <button className="btn btn-glass btn-sm" onClick={() => load(true)}><LuRotateCw aria-hidden="true" /> Try again</button>
          </div>
        ) : <p className="discover-note">{emptyText || "Nothing matches these filters. Try another genre or year."}</p>
      ) : null}
      <div ref={sentinel} className="discover-more">
        {loading && items.length ? <span className="discover-more-line" role="status"><LuLoaderCircle className="spin" aria-hidden="true" /> Loading more</span> : null}
        {!loading && error && items.length ? (
          <span className="discover-more-line" role="alert" title={error}>
            Couldn't load more titles.
            <button className="btn btn-glass btn-sm" onClick={() => load(false)}><LuRotateCw aria-hidden="true" /> Try again</button>
          </span>
        ) : null}
        {!loading && !error && next < 0 && items.length > 12 ? <span className="discover-more-line discover-end">That's everything in {source?.name || "this catalog"}.</span> : null}
      </div>
    </>
  );
}

/** A row of catalogs to pick from (name over the addon it comes from). */
export function SourcePicker({ sources, value, onChange, label: ariaLabel = "Catalog" }) {
  const listRef = useRef(null);
  // Keep the chosen catalog in view when it changes (long lists scroll sideways).
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-pressed="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <div ref={listRef} className="discover-sources" role="tablist" aria-label={ariaLabel} data-keep-scroll>
      {!sources ? Array.from({ length: 6 }, (_, i) => <span key={i} className="discover-source skel" />) : sources.map(s => (
        <button key={s.id} role="tab" className="discover-source" aria-pressed={s.id === value} onClick={() => onChange(s.id)} title={`${s.name} · ${s.addon}`}>
          <span className="discover-source-name">{s.name}</span>
          <span className="discover-source-addon">{s.addon}{s.searchOnly ? " · search" : ""}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Every catalog your addons offer for this section, with the filters each one supports
 * (genre, year, rating...), page after page as you scroll.
 */
export default function Discover({ kind }) {
  const [sources, setSources] = useState(null);
  const [sourceId, setSourceId] = useState(null);
  const [filters, setFilters] = useState({});
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
  useEffect(() => { if (source) remember(storeKey, { source: source.id, filters }); }, [source, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sources && !sources.length) {
    return (
      <section className="empty">
        <h2>Nothing to browse yet</h2>
        <p>None of your addons has a catalog here. Add one from Settings › Addons › Store (The Movie Database, Anime Kitsu, Streaming Catalogs…).</p>
      </section>
    );
  }

  return (
    <section className="discover">
      <SourcePicker sources={sources} value={sourceId} onChange={id => { setSourceId(id); setFilters({}); }} />
      <CatalogGrid source={source} filters={filters} onFilters={setFilters} />
    </section>
  );
}
