import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { ContinueCard, PosterCard } from "../components/Cards.jsx";
import { navigate } from "../lib/router.js";
import { useSegmentPill } from "../lib/motion.js";
import { useScreenActive } from "../lib/screen.js";
import TorboxClear from "../components/TorboxClear.jsx";
import { LuRefreshCw, LuTrash2 } from "react-icons/lu";
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
  const active = useScreenActive();
  // TorBox: read straight from the library catalogs (they may be hidden from Home).
  const [cloud, setCloud] = useState(null);
  const [clearing, setClearing] = useState(false);
  const loadCloud = () => call("library.cloud", {}, { timeoutMs: 30000 }).then(r => setCloud(r?.items || []), () => setCloud([]));
  useEffect(() => { if (active && tab === "cloud") loadCloud(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [active, tab]);
  const tabsRef = useRef(null);
  useSegmentPill(tabsRef);

  useEffect(() => { call("library.subscribe").catch(() => {}); }, []);

  const items = useMemo(() => {
    const source = tab === "later" ? watchLater : tab === "saved" ? library.items || [] : tab === "cloud" ? cloud || library.cloud || [] : [];
    const list = [...source];
    if (sort === "recent" && list.some(item => item.addedAt)) list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "year") list.sort((a, b) => String(b.releaseInfo || "").localeCompare(String(a.releaseInfo || "")));
    return list;
  }, [tab, watchLater, library, sort, cloud]);

  const counts = { later: watchLater.length, continue: continueWatching.length, saved: (library.items || []).length, cloud: (cloud || library.cloud || []).length };

  return (
    <main className="screen library">
      <section className="library-head">
        <h1 className="t-page">Library</h1>
        <div className="library-bar">
          <div ref={tabsRef} className="seg glass-flat" role="tablist" aria-label="Library">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-pressed={tab === t.id} onClick={() => navigate("library", { tab: t.id }, { replace: true })}>
                {t.label} <span className="library-count num">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          {tab === "cloud" ? (
            <div className="library-cloud-tools">
              <button className="btn btn-ghost btn-sm" onClick={loadCloud} aria-label="Reload TorBox library" title="Reload"><LuRefreshCw /></button>
              <button className="btn btn-glass btn-sm library-clear" onClick={() => setClearing(true)}><LuTrash2 /> Clear TorBox library</button>
            </div>
          ) : null}
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
                  ? "What you play through TorBox collects here. It's hidden from Home; clear it any time with the button above."
                  : "Titles you add to your library appear here."}
          </p>
        </section>
      ) : null}
      {clearing ? <TorboxClear onClose={() => setClearing(false)} onCleared={() => { setCloud([]); window.setTimeout(loadCloud, 2500); }} /> : null}
      <div className="screen-end" />
    </main>
  );
}
