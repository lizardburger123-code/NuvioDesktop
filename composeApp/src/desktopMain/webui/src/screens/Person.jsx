import { useEffect, useMemo, useRef, useState } from "react";
import { LuArrowLeft, LuRotateCw, LuSearch } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { back, canGoBack, navigate } from "../lib/router.js";
import { useSegmentPill } from "../lib/motion.js";
import { year } from "../lib/format.js";
import { PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import "./Person.css";

const cache = new Map();
const KINDS = [["all", "Everything"], ["movie", "Films"], ["series", "Series"]];
const SORTS = [["new", "Newest first"], ["old", "Oldest first"]];
const SORT_KEY = "nuvio.person.sort";
const savedSort = () => { try { return window.localStorage.getItem(SORT_KEY) === "old" ? "old" : "new"; } catch { return "new"; } };
const initialsOf = name => name.split(/\s+/).map(word => word[0] || "").join("").slice(0, 2).toUpperCase();
const yearOf = item => Number(year(item.releaseInfo)) || null;

/** Everything a person is in (as cast, voice or director), newest or oldest first. */
export default function Person({ params }) {
  const { name, photo, titleId } = params;
  // The title the name was picked from tells namesakes apart, so it is part of what is cached.
  const key = `${name}|${titleId || ""}`;
  const { openDetails, toggleLater, laterIds } = useApp();
  const [state, setState] = useState(() => (cache.has(key) ? { items: cache.get(key) } : { loading: true }));
  const [attempt, setAttempt] = useState(0);
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState(savedSort);
  const [face, setFace] = useState(Boolean(photo));
  const kindsRef = useRef(null);
  const sortRef = useRef(null);
  useSegmentPill(kindsRef);
  useSegmentPill(sortRef);

  useEffect(() => {
    if (cache.has(key)) { setState({ items: cache.get(key) }); return undefined; }
    let alive = true;
    setState({ loading: true });
    call("people.works", titleId ? { name, titleId } : { name }).then(
      result => { const items = result?.items || []; if (items.length) cache.set(key, items); if (alive) setState({ items }); },
      error => { if (alive) setState({ error: error.message || "No answer came back.", items: [] }); },
    );
    return () => { alive = false; };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = state.items || [];
  const counts = useMemo(() => ({ all: items.length, movie: items.filter(item => item.type === "movie").length, series: items.filter(item => item.type === "series").length }), [items]);
  // Titles without a year go last whichever way the list runs; ties keep the order they came in.
  const shown = useMemo(() => {
    const list = kind === "all" || !counts[kind] ? items : items.filter(item => item.type === kind);
    return [...list].sort((a, b) => {
      const x = yearOf(a);
      const y = yearOf(b);
      if (x == null || y == null) return (x == null) - (y == null);
      return sort === "new" ? y - x : x - y;
    });
  }, [items, kind, sort, counts]);
  const chooseSort = next => { setSort(next); try { window.localStorage.setItem(SORT_KEY, next); } catch { /* a nicety */ } };
  const searchName = () => navigate("search", { q: name });

  return (
    <main className="screen person-page" aria-busy={state.loading || undefined}>
      <header className="person-head">
        <div className="person-face">
          {photo && face ? <img src={photo} alt="" onError={event => { if (event.currentTarget.dataset.broken) setFace(false); }} /> : <span>{initialsOf(name)}</span>}
        </div>
        <div className="person-id">
          <span className="person-kicker">Cast and crew</span>
          <h1 className="t-page" dir="auto">{name}</h1>
          <p className="t-meta num" role="status">{state.loading ? "Looking up their work" : items.length ? `${items.length} ${items.length === 1 ? "title" : "titles"}` : ""}</p>
        </div>
      </header>

      {items.length ? (
        <div className="person-tools">
          <div className="seg person-kinds" role="group" aria-label="Kind of title" ref={kindsRef}>
            {KINDS.filter(([id]) => id === "all" || counts[id] > 0).map(([id, label]) => (
              <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)}>{label} <span className="num">{counts[id]}</span></button>
            ))}
          </div>
          <div className="seg person-sort" role="group" aria-label="Order" ref={sortRef}>
            {SORTS.map(([id, label]) => <button key={id} aria-pressed={sort === id} onClick={() => chooseSort(id)}>{label}</button>)}
          </div>
        </div>
      ) : null}

      {state.loading ? <div className="person-grid" aria-hidden="true"><SkeletonPosters count={12} /></div> : null}
      {!state.loading && items.length ? (
        <div className="person-grid">
          {shown.map(item => (
            <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
          ))}
        </div>
      ) : null}
      {!state.loading && !items.length ? (
        <section className="empty person-empty" role={state.error ? "alert" : undefined}>
          <h2 dir="auto">{state.error ? `Couldn't look up ${name}` : `No films or series found for ${name}`}</h2>
          <p>
            {state.error
              ? `${state.error} Check your connection, then try again.`
              : "The open film database this page uses (Wikidata) lists nothing under exactly this name. A search may still find titles they are in."}
          </p>
          <div className="person-actions">
            {state.error ? <button className="btn btn-primary btn-sm" onClick={() => setAttempt(n => n + 1)}><LuRotateCw /> Try again</button> : null}
            <button className={`btn btn-sm ${state.error ? "btn-glass" : "btn-primary"}`} onClick={searchName}><LuSearch /> Search for “{name}”</button>
            {canGoBack() ? <button className="btn btn-sm btn-line" onClick={() => back()}><LuArrowLeft /> Back</button> : null}
          </div>
        </section>
      ) : null}
      <div className="screen-end" />
    </main>
  );
}
