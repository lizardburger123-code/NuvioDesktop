import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuRefreshCw, LuSearch, LuTrash2, LuX } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { ContinueCard, PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import { goSection, navigate } from "../lib/router.js";
import { useScreenActive } from "../lib/screen.js";
import { useSegmentPill } from "../lib/motion.js";
import TorboxClear from "../components/TorboxClear.jsx";
import Downloads from "../components/Downloads.jsx";
import Trophies from "../components/Trophies.jsx";
import "./Library.css";

const TABS = [
  { id: "later", label: "My list" },
  { id: "continue", label: "Continue watching" },
  { id: "saved", label: "Saved" },
  { id: "completed", label: "Trophies" },
  { id: "cloud", label: "TorBox" },
  { id: "downloads", label: "Downloads" },
];
const NO_ITEMS = [];

// ---- Sorting, kinds and finding, for the poster tabs ------------------------------------------

const SORTS = { recent: "Recently added", name: "A to Z", year: "Year", rating: "Rating" };
const KINDS = { movie: "Films", series: "Series", anime: "Anime" };
const VIEW = "nuvio.library.view";
const loadView = () => {
  try { return { sort: "recent", kind: "all", ...JSON.parse(localStorage.getItem(VIEW)) }; } catch { return { sort: "recent", kind: "all" }; }
};
const ANIME_ID = /^(kitsu|mal|anilist|anidb):/i;
const kindOf = item => (ANIME_ID.test(String(item.id)) || (item.genres || []).some(genre => /^anime$/i.test(genre)) ? "anime" : item.type === "movie" ? "movie" : item.type === "series" ? "series" : "other");
const fold = text => String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const yearOf = item => Number((String(item.releaseInfo || "").match(/\d{4}/) || [0])[0]);
const ratingOf = item => parseFloat(item.imdbRating) || 0;
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base", numeric: true });
const SORTERS = {
  recent: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
  name: byName,
  year: (a, b) => yearOf(b) - yearOf(a) || byName(a, b),
  rating: (a, b) => ratingOf(b) - ratingOf(a) || byName(a, b),
};

/** Tab counts, in their own component: a topic push (downloads tick twice a second) re-renders only this. */
const LibraryTabs = memo(function LibraryTabs({ tab, cloudCount, pending }) {
  const { watchLater } = useApp();
  const continueWatching = useTopic("continue", NO_ITEMS);
  const library = useTopic("library", null);
  const completed = useTopic("completed", NO_ITEMS);
  const downloads = useTopic("downloads", NO_ITEMS);
  // Taken off but still undoable: not counted, so the count agrees with what the tab shows.
  const counts = {
    later: watchLater.length,
    continue: continueWatching.filter(entry => !pending.continue.has(entry.key)).length,
    saved: library?.items?.length ?? 0,
    completed: completed.length,
    cloud: cloudCount,
    downloads: downloads.filter(item => !pending.downloads.has(item.id)).length,
  };
  const listRef = useRef(null);
  const go = id => navigate("library", { tab: id }, { replace: true });
  // Arrow keys move along the tabs, like any tab list.
  const onKeyDown = event => {
    const i = TABS.findIndex(t => t.id === tab);
    const next = event.key === "ArrowRight" ? i + 1 : event.key === "ArrowLeft" ? i - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (next == null) return;
    event.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length];
    go(target.id);
    listRef.current?.querySelector(`#library-tab-${target.id}`)?.focus();
  };
  return (
    <div ref={listRef} className="tabs" role="tablist" aria-label="Library" onKeyDown={onKeyDown}>
      {TABS.map(t => (
        <button key={t.id} id={`library-tab-${t.id}`} role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => go(t.id)}>
          {t.label}{counts[t.id] != null ? <span className="tabs-count num">{counts[t.id]}</span> : null}
        </button>
      ))}
    </div>
  );
});

export default function Library({ params }) {
  const tab = TABS.some(t => t.id === params.tab) ? params.tab : "later";
  const active = useScreenActive();
  // TorBox: read straight from the library catalogs (they may be hidden from Home). Its count
  // shows once that answer is in, so it doesn't change under the user.
  const [cloud, setCloud] = useState({ items: null, error: null });
  const [clearing, setClearing] = useState(false);
  // Continue watching entries and downloads taken off while their Undo is up.
  const [pending, setPending] = useState(() => ({ continue: new Set(), downloads: new Set() }));
  const hold = useCallback((kind, key, on) => setPending(prev => {
    const next = new Set(prev[kind]);
    if (on) next.add(key);
    else next.delete(key);
    return { ...prev, [kind]: next };
  }), []);
  const loadCloud = useCallback(() => {
    setCloud(prev => ({ ...prev, error: null, loading: true }));
    call("library.cloud", {}, { timeoutMs: 30000 }).then(
      result => setCloud({ items: result?.items || [], error: null }),
      error => setCloud(prev => ({ items: prev.items, error: error.message || "TorBox didn't answer." })),
    );
  }, []);
  useEffect(() => { if (active && tab === "cloud") loadCloud(); }, [active, tab, loadCloud]);
  useEffect(() => {
    call("library.subscribe").catch(() => {});
    call("downloads.subscribe").catch(() => {});
  }, []);

  return (
    <main className="screen library">
      <section className="library-head">
        <h1 className="t-page">Library</h1>
        <div className="library-bar">
          <LibraryTabs tab={tab} cloudCount={cloud.items ? cloud.items.length : null} pending={pending} />
          <div className="library-tools">
            {tab === "cloud" ? (
              <div className="library-cloud-tools">
                <button className="btn btn-ghost btn-sm btn-icon" onClick={loadCloud} disabled={cloud.loading} aria-label="Reload TorBox library" title="Reload"><LuRefreshCw /></button>
                <button className="btn btn-glass btn-sm" onClick={() => setClearing(true)}><LuTrash2 /> Clear TorBox library</button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div role="tabpanel" aria-labelledby={`library-tab-${tab}`}>
        {tab === "downloads" ? <Downloads gone={pending.downloads} onGone={(id, on) => hold("downloads", id, on)} />
          : tab === "completed" ? <Trophies />
            : tab === "continue" ? <ContinueTab hidden={pending.continue} onHide={(key, on) => hold("continue", key, on)} />
              : tab === "cloud" ? <CloudTab state={cloud} onRetry={loadCloud} />
                : tab === "saved" ? <SavedTab />
                  : <LaterTab />}
      </div>

      {clearing ? <TorboxClear onClose={() => setClearing(false)} onCleared={() => { setCloud({ items: [], error: null }); window.setTimeout(loadCloud, 2500); }} /> : null}
      <div className="screen-end" />
    </main>
  );
}

function LaterTab() {
  const { watchLater } = useApp();
  return (
    <PosterTab
      items={watchLater}
      what="your list"
      empty={(
        <section className="empty">
          <h2>Your list is empty</h2>
          <p>Hover any poster and press the bookmark, or use Add to list on a title's page. Everything you keep for later waits here.</p>
          <button className="btn btn-glass btn-sm" onClick={() => goSection("search")}><LuSearch /> Search for a title</button>
        </section>
      )}
    />
  );
}

function SavedTab() {
  const library = useTopic("library", null);
  return (
    <PosterTab
      items={library?.items || NO_ITEMS}
      loading={!library}
      what="saved titles"
      empty={(
        <section className="empty">
          <h2>No saved titles</h2>
          <p>Titles saved to your library appear here.</p>
        </section>
      )}
    />
  );
}

function CloudTab({ state, onRetry }) {
  const library = useTopic("library", null);
  // Until the TorBox catalogs answer, show what Home already had from them.
  const items = state.items || library?.cloud || NO_ITEMS;
  if (state.error && !items.length) {
    return (
      <section className="empty">
        <h2>Couldn't load your TorBox library</h2>
        <p dir="auto">{state.error}</p>
        <button className="btn btn-glass btn-sm" onClick={onRetry}><LuRefreshCw /> Try again</button>
      </section>
    );
  }
  return (
    <PosterTab
      items={items}
      loading={!state.items && !items.length}
      what="your TorBox library"
      empty={(
        <section className="empty">
          <h2>Your TorBox library is empty</h2>
          <p>What you play through TorBox collects here. It's hidden from Home; clear it any time with the button above.</p>
        </section>
      )}
    />
  );
}

function ContinueTab({ hidden, onHide }) {
  const { resume, toast } = useApp();
  const entries = useTopic("continue", NO_ITEMS);
  // Taken off at once and only forgotten when the Undo has passed: the app keeps no copy to restore.
  const remove = useCallback(entry => {
    onHide(entry.key, true);
    let undone = false;
    const timer = window.setTimeout(() => {
      if (undone) return;
      call("continue.remove", { id: entry.id, type: entry.type }).catch(error => {
        onHide(entry.key, false);
        toast(error.message, { tone: "error" });
      });
    }, 5400);
    toast(`Removed ${entry.name} from Continue watching`, {
      action: { label: "Undo", run: () => { undone = true; window.clearTimeout(timer); onHide(entry.key, false); } },
    });
  }, [toast, onHide]);
  const shown = useMemo(() => entries.filter(entry => !hidden.has(entry.key)), [entries, hidden]);
  if (!shown.length) {
    return (
      <section className="empty">
        <h2>Nothing in progress</h2>
        <p>Anything you start watching shows up here with the time you have left.</p>
        <button className="btn btn-glass btn-sm" onClick={() => goSection("browse", { kind: "series" })}>Browse series</button>
      </section>
    );
  }
  return (
    <section className="library-grid library-grid-wide">
      {shown.map(entry => <ContinueCard key={entry.key} entry={entry} onResume={resume} onRemove={remove} />)}
    </section>
  );
}

/**
 * A grid of posters with a way through it: find by name, one kind, and an order. The choice of
 * kind and order is remembered. Long lists draw in steps as you scroll, so a list of hundreds
 * opens as fast as a short one.
 */
function PosterTab({ items, loading = false, what, empty }) {
  const { laterIds, toggleLater, openDetails } = useApp();
  const [view, setView] = useState(loadView);
  const [find, setFind] = useState("");
  const kindRef = useRef(null);
  useSegmentPill(kindRef);
  const choose = patch => setView(prev => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(VIEW, JSON.stringify(next)); } catch { /* a nicety */ }
    return next;
  });

  const kinds = useMemo(() => {
    const counts = new Map();
    items.forEach(item => { const kind = kindOf(item); counts.set(kind, (counts.get(kind) || 0) + 1); });
    return Object.keys(KINDS).filter(kind => counts.has(kind)).map(kind => [kind, counts.get(kind)]);
  }, [items]);
  // A remembered kind this list doesn't have shows everything.
  const kind = view.kind !== "all" && kinds.some(([k]) => k === view.kind) ? view.kind : "all";
  const sort = SORTS[view.sort] ? view.sort : "recent";
  const wanted = fold(find.trim());
  const shown = useMemo(() => {
    const list = items.filter(item => (kind === "all" || kindOf(item) === kind) && (!wanted || fold(item.name).includes(wanted)));
    // Recently added: newest first when the list says when; otherwise the order it came in.
    if (sort !== "recent" || list.some(item => item.addedAt)) list.sort(SORTERS[sort]);
    return list;
  }, [items, kind, sort, wanted]);

  if (loading) return <section className="library-grid" aria-busy="true"><SkeletonPosters count={8} /></section>;
  if (!items.length) return empty;
  const filtered = shown.length !== items.length;
  return (
    <>
      <div className="library-toolbar" role="toolbar" aria-label={`Sort and filter ${what}`}>
        <label className="library-find">
          <LuSearch aria-hidden="true" />
          <input
            className="field"
            value={find}
            onChange={event => setFind(event.target.value)}
            onKeyDown={event => { if (event.key === "Escape" && find) { event.preventDefault(); event.stopPropagation(); setFind(""); } }}
            placeholder={`Find in ${what}`}
            aria-label={`Find in ${what}`}
            spellCheck={false}
            autoComplete="off"
            dir="auto"
          />
          {find ? <button type="button" className="library-find-x" onClick={() => setFind("")} aria-label="Clear" title="Clear (Esc)"><LuX /></button> : null}
        </label>
        {kinds.length > 1 ? (
          <div ref={kindRef} className="seg" role="group" aria-label="Kind">
            <button aria-pressed={kind === "all"} onClick={() => choose({ kind: "all" })}>All</button>
            {kinds.map(([k, n]) => (
              <button key={k} aria-pressed={kind === k} onClick={() => choose({ kind: k })}>{KINDS[k]} <span className="num library-seg-n">{n}</span></button>
            ))}
          </div>
        ) : null}
        <span className="library-showing num" aria-live="polite">{filtered ? `${shown.length} of ${items.length}` : ""}</span>
        <label className="library-sort">
          <span className="t-meta">Sort</span>
          <select value={sort} onChange={event => choose({ sort: event.target.value })} className="field">
            {Object.entries(SORTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      {shown.length ? (
        <Progressive items={shown} render={item => (
          <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
        )} />
      ) : (
        <section className="empty">
          <h2>{wanted ? <>Nothing in {what} called “<bdi>{find.trim()}</bdi>”</> : `No ${KINDS[kind]?.toLowerCase() || "titles"} in ${what}`}</h2>
          <button className="btn btn-glass btn-sm" onClick={() => { setFind(""); choose({ kind: "all" }); }}>Show everything</button>
        </section>
      )}
    </>
  );
}

const STEP = 60;

/** The first cards at once, the rest a screenful ahead of the scroll. */
function Progressive({ items, render }) {
  const [count, setCount] = useState(STEP);
  const endRef = useRef(null);
  const more = items.length > count;
  useEffect(() => {
    const node = endRef.current;
    if (!node || !more) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setCount(n => n + STEP);
    }, { rootMargin: "1200px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, count]);
  return (
    <>
      <section className="library-grid">{items.slice(0, count).map(render)}</section>
      {more ? <div ref={endRef} className="library-more" aria-hidden="true" /> : null}
    </>
  );
}
