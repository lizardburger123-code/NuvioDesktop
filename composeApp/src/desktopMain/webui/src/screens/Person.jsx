import { useEffect, useMemo, useState } from "react";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import "./Person.css";

const cache = new Map();
const KINDS = [["all", "Everything"], ["movie", "Films"], ["series", "Series"]];

/** Everything a person is in (as cast, voice or director), newest first. */
export default function Person({ params }) {
  const { name, photo } = params;
  const { openDetails, toggleLater, laterIds } = useApp();
  const [state, setState] = useState(() => (cache.has(name) ? { items: cache.get(name) } : { loading: true }));
  const [kind, setKind] = useState("all");

  useEffect(() => {
    if (cache.has(name)) { setState({ items: cache.get(name) }); return undefined; }
    let alive = true;
    setState({ loading: true });
    call("people.works", { name }).then(
      result => { const items = result?.items || []; if (items.length) cache.set(name, items); if (alive) setState({ items }); },
      error => { if (alive) setState({ error: error.message, items: [] }); },
    );
    return () => { alive = false; };
  }, [name]);

  const items = state.items || [];
  const shown = useMemo(() => (kind === "all" ? items : items.filter(item => item.type === kind)), [items, kind]);
  const counts = useMemo(() => ({ all: items.length, movie: items.filter(item => item.type === "movie").length, series: items.filter(item => item.type === "series").length }), [items]);
  const initials = name.split(/\s+/).map(word => word[0]).join("").slice(0, 2);

  return (
    <main className="screen person-page">
      <header className="person-head">
        <div className="person-face">{photo ? <img src={photo} alt="" /> : <span>{initials}</span>}</div>
        <div className="person-id">
          <span className="person-kicker">Cast and crew</span>
          <h1 className="t-page" dir="auto">{name}</h1>
          <p className="t-meta num">{state.loading ? "Looking up their work" : items.length ? `${items.length} ${items.length === 1 ? "title" : "titles"}, newest first` : ""}</p>
        </div>
      </header>

      {items.length ? (
        <div className="seg person-kinds" role="group" aria-label="Kind of title">
          {KINDS.filter(([id]) => id === "all" || counts[id] > 0).map(([id, label]) => (
            <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)}>{label} <span className="num">{counts[id]}</span></button>
          ))}
        </div>
      ) : null}

      {state.loading ? <div className="person-grid"><SkeletonPosters count={12} /></div> : null}
      {!state.loading && items.length ? (
        <div className="person-grid">
          {shown.map(item => (
            <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
          ))}
        </div>
      ) : null}
      {!state.loading && !items.length ? (
        <section className="empty">
          <h2>{state.error ? "Couldn't look that up" : `Nothing found for ${name}`}</h2>
          <p>{state.error || "The open film database this uses (Wikidata) has no films or series listed under exactly this name."}</p>
        </section>
      ) : null}
      <div className="screen-end" />
    </main>
  );
}
