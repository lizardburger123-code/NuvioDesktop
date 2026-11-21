import { useEffect, useMemo, useRef, useState } from "react";
import { LuArrowLeft, LuRotateCw, LuSearch } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { back, canGoBack, navigate } from "../lib/router.js";
import { useSegmentPill } from "../lib/motion.js";
import { year } from "../lib/format.js";
import { PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import { Pictures, useChunks, useLite, usePicturesValue, watchWindow } from "../lib/lite.js";
import { sized } from "../lib/images.js";
import "./Person.css";

const cache = new Map();
const KINDS = [["all", "Everything"], ["movie", "Films"], ["series", "Series"]];
const SORTS = [["new", "Newest first"], ["old", "Oldest first"]];
const SORT_KEY = "nuvio.person.sort";
const savedSort = () => { try { return window.localStorage.getItem(SORT_KEY) === "old" ? "old" : "new"; } catch { return "new"; } };
const initialsOf = name => name.split(/\s+/).map(word => word[0] || "").join("").slice(0, 2).toUpperCase();
const yearOf = item => Number(year(item.releaseInfo)) || null;
// The app gives the lookup 16 seconds; an answer that hasn't come by LIMIT_MS isn't coming.
const LIMIT_MS = 20000;
// How long the page waits quietly before it says the lookup is slow and offers other ways on.
const SLOW_MS = 6000;
const sentence = text => (/[.!?]$/.test(text) ? text : `${text}.`);
const reasonOf = error => (error?.timeout ? "The film database took too long to answer." : sentence(String(error?.message || "No answer came back").trim()));

/** Everything a person is in (as cast, voice or director), newest or oldest first. */
export default function Person({ params }) {
  const { name, photo, titleId } = params;
  // The title the name was picked from tells namesakes apart, so it is part of what is cached.
  const key = `${name}|${titleId || ""}`;
  const { openDetails, toggleLater, laterIds } = useApp();
  const lite = useLite();
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
    // Each lookup stands alone: once another person or another try has taken its place, or the
    // screen is gone, whatever it comes back with is dropped. One that outlives LIMIT_MS is
    // dropped by the bridge, so a late answer never replaces the message already on screen.
    let alive = true;
    setState({ loading: true });
    const slow = window.setTimeout(() => { if (alive) setState({ loading: true, slow: true }); }, SLOW_MS);
    call("people.works", titleId ? { name, titleId } : { name }, { timeoutMs: LIMIT_MS }).then(
      result => {
        window.clearTimeout(slow);
        const items = Array.isArray(result?.items) ? result.items : [];
        if (items.length) cache.set(key, items);
        if (alive) setState({ items });
      },
      error => {
        window.clearTimeout(slow);
        if (alive) setState({ error: reasonOf(error), items: [] });
      },
    );
    return () => { alive = false; window.clearTimeout(slow); };
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
  // Lite draws a long filmography a few lines at a time; another kind or order starts again.
  const drawn = useChunks(shown, { resetKey: `${key}:${kind}:${sort}` });
  const pictures = usePicturesValue(watchWindow);
  const chooseSort = next => { setSort(next); try { window.localStorage.setItem(SORT_KEY, next); } catch { /* a nicety */ } };
  const searchName = () => navigate("search", { q: name });

  return (
    <main className="screen person-page" aria-busy={state.loading || undefined}>
      <header className="person-head">
        <div className="person-face">
          {photo && face ? <img src={sized(photo, "face", lite)} alt="" onError={event => { if (event.currentTarget.dataset.broken) setFace(false); }} /> : <span>{initialsOf(name)}</span>}
        </div>
        <div className="person-id">
          <span className="person-kicker">Cast and crew</span>
          <h1 className="t-page" dir="auto">{name}</h1>
          <p className="t-meta num" role="status">{state.loading ? (state.slow ? "Still looking. The film database is slow to answer." : "Looking up their work") : items.length ? `${items.length} ${items.length === 1 ? "title" : "titles"}` : ""}</p>
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

      {/* A slow lookup is never a dead end: the other ways on are offered while it runs. */}
      {state.loading && state.slow ? (
        <div className="person-wait">
          <button className="btn btn-sm btn-glass" onClick={searchName}><LuSearch /> Search for “{name}”</button>
          {canGoBack() ? <button className="btn btn-sm btn-line" onClick={() => back()}><LuArrowLeft /> Back</button> : null}
        </div>
      ) : null}
      {state.loading ? <div className="person-grid" aria-hidden="true"><SkeletonPosters count={12} /></div> : null}
      {!state.loading && items.length ? (
        <div className="person-grid">
          <Pictures.Provider value={pictures}>
            {drawn.shown.map(item => (
              <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
            ))}
          </Pictures.Provider>
        </div>
      ) : null}
      {!state.loading && drawn.more ? <div ref={drawn.endRef} className="person-more" aria-hidden="true" /> : null}
      {!state.loading && !items.length ? (
        <section className="empty person-empty" role={state.error ? "alert" : undefined}>
          <h2 dir="auto">{state.error ? `Couldn't look up ${name}` : `No films or series found for ${name}`}</h2>
          <p>
            {state.error
              ? `${state.error} Try again in a moment, or search for the name instead.`
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
