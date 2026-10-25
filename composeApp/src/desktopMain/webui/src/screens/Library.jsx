import { useEffect, useMemo, useState } from "react";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { ContinueCard, PosterCard } from "../components/Cards.jsx";
import { navigate } from "../lib/router.js";
import "./Library.css";

const TABS = [
  { id: "later", label: "Watch later" },
  { id: "continue", label: "Continue watching" },
  { id: "saved", label: "Saved" },
  { id: "cloud", label: "TorBox" },
];

const SORTS = { recent: "Recently added", name: "A to Z", year: "Year" };

export default function Library({ params }) {
  const tab = params.tab || "later";
  const { watchLater, laterIds, toggleLater, openDetails, resume, removeContinue } = useApp();
  const library = useTopic("library", { items: [], cloud: [] });
  const continueWatching = useTopic("continue", []);
  const [sort, setSort] = useState("recent");

  useEffect(() => { call("library.subscribe").catch(() => {}); }, []);

  const items = useMemo(() => {
    const source = tab === "later" ? watchLater : tab === "saved" ? library.items || [] : tab === "cloud" ? library.cloud || [] : [];
    const list = [...source];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "year") list.sort((a, b) => String(b.releaseInfo || "").localeCompare(String(a.releaseInfo || "")));
    return list;
  }, [tab, watchLater, library, sort]);

  const counts = { later: watchLater.length, continue: continueWatching.length, saved: (library.items || []).length, cloud: (library.cloud || []).length };

  return (
    <main className="screen library">
      <section className="library-head">
        <h1 className="t-page">Library</h1>
        <div className="library-bar">
          <div className="seg glass-flat" role="tablist" aria-label="Library">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-pressed={tab === t.id} onClick={() => navigate("library", { tab: t.id }, { replace: true })}>
                {t.label} <span className="library-count num">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          {tab !== "continue" ? (
            <label className="library-sort">
              <span className="t-meta">Sort</span>
              <select value={sort} onChange={event => setSort(event.target.value)} className="field">
                {Object.entries(SORTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </section>

      {tab === "continue" ? (
        <section className="library-grid library-grid-wide">
          {continueWatching.map(entry => <ContinueCard key={entry.key} entry={entry} onResume={resume} onRemove={removeContinue} />)}
        </section>
      ) : (
        <section className="library-grid">
          {items.map(item => (
            <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
          ))}
        </section>
      )}

      {(tab === "continue" ? continueWatching.length : items.length) === 0 ? (
        <section className="library-empty">
          <h2 className="t-title">
            {tab === "later" ? "Nothing saved for later" : tab === "continue" ? "Nothing in progress" : tab === "cloud" ? "Your TorBox library is empty" : "No saved titles"}
          </h2>
          <p className="t-meta">
            {tab === "later"
              ? "Hover any poster and press the bookmark, or use Watch later on a title's page."
              : tab === "continue"
                ? "Anything you start watching shows up here with the time you have left."
                : tab === "cloud"
                  ? "Files in your TorBox account appear here once the TorBox integration is set up."
                  : "Titles you add to your library appear here."}
          </p>
        </section>
      ) : null}
      <div className="screen-end" />
    </main>
  );
}
