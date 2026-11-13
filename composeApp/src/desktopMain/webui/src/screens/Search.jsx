import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuPuzzle, LuRotateCw, LuSearch } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import SearchHero from "../components/SearchHero.jsx";
import Row from "../components/Row.jsx";
import { PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import { navigate } from "../lib/router.js";
import { useScreenActive } from "../lib/screen.js";
import { recovered } from "../lib/session.js";
import { loadHistory, recordSearch } from "../lib/searchHistory.js";
import { EASE, reduceMotion, useSegmentPill } from "../lib/motion.js";
import "./Search.css";

const TYPING_MS = 300; // a pause this long in typing runs the search
const KIND_LABELS = { movie: "Films", series: "Series", anime: "Anime", tv: "TV", channel: "Channels" };
const KIND_ORDER = ["movie", "series", "anime"];
const kindLabel = kind => KIND_LABELS[kind] || (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Other");
const ROW_MAX = 30;
const FILTERS = "nuvio.search.filters";
const loadFilters = () => { try { return JSON.parse(localStorage.getItem(FILTERS)) || {}; } catch { return {}; } };
const IDLE = { query: "", loading: false, sections: [] };
const EMPTY = [];

// Search is one place: opened again (or rebuilt after the page was lost) it shows the search you
// left. The query lives here rather than in the route, so the top bar and Ctrl+K come back to it.
const LAST = "nuvio.search.last";
let lastQuery = "";
try { lastQuery = recovered ? sessionStorage.getItem(LAST) || "" : ""; } catch { /* a nicety */ }
const rememberQuery = query => {
  lastQuery = query;
  try { sessionStorage.setItem(LAST, query); } catch { /* a nicety */ }
};

// Answers already seen, newest last: Backspace to an earlier query, or a search screen built
// again, shows them at once instead of a skeleton.
const answers = new Map();
const keepAnswer = (query, answer) => {
  answers.delete(query);
  answers.set(query, answer);
  if (answers.size > 12) answers.delete(answers.keys().next().value);
};

// ---- People: a query that reads like a name also asks who has that name -----------------------

const people = new Map(); // name -> their works ([] for no such person)
const NOT_NAMES = new Set(["the", "a", "an", "of", "and", "in", "on", "at", "to", "for", "with", "from", "my", "season", "part", "episode", "movie", "film", "series", "vs"]);
const WORD = /^\p{Script=Latin}[\p{Script=Latin}'’.-]*$/u;
const personName = query => {
  const words = query.split(/\s+/);
  if (words.length < 2 || words.length > 4 || query.length > 48) return null;
  if (!words.every(word => WORD.test(word)) || words.some(word => NOT_NAMES.has(word.toLowerCase()))) return null;
  // The film database knows names exactly as written: one typed in lower case gets capitals.
  return query === query.toLowerCase() ? words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") : words.join(" ");
};

// ---- Results ----------------------------------------------------------------------------------

const fold = text => String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * One list per kind (films, series, anime) whatever addon found them. The addons' lists are
 * interleaved so each one's best answers come first, a title found twice shows once, and a title
 * named what was typed goes to the front (its kind too).
 */
function groupResults(sections, query, addon) {
  const byKind = new Map();
  sections.forEach(section => {
    if (!section.items?.length || (addon !== "all" && (section.addonName || "Other") !== addon)) return;
    const kind = section.type || "other";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(section.items);
  });
  const wanted = fold(query);
  const rank = item => { const name = fold(item.name); return name === wanted ? 0 : name.startsWith(wanted) ? 1 : 2; };
  const order = kind => (KIND_ORDER.includes(kind) ? KIND_ORDER.indexOf(kind) : KIND_ORDER.length);
  return [...byKind.entries()].map(([kind, lists]) => {
    const seen = new Set();
    const merged = [];
    const longest = Math.max(...lists.map(list => list.length));
    for (let i = 0; i < longest; i += 1) {
      lists.forEach(list => {
        const item = list[i];
        const key = item && `${item.type}:${item.id}`;
        if (!item || seen.has(key)) return;
        seen.add(key);
        merged.push({ item, rank: rank(item), at: merged.length });
      });
    }
    merged.sort((a, b) => a.rank - b.rank || a.at - b.at);
    return { kind, label: kindLabel(kind), items: merged.map(entry => entry.item), best: merged[0]?.rank ?? 2 };
  }).sort((a, b) => a.best - b.best || order(a.kind) - order(b.kind));
}

/** A shorter search worth offering when nothing was found: without a year or season, or a word less. */
const simpler = query => {
  const bare = query.replace(/\b(19|20)\d{2}\b/g, " ").replace(/\bs\d{1,2}(e\d{1,3})?\b/gi, " ").replace(/\b(season|part|episode|ep)\.?\s*\d+\b/gi, " ").replace(/\s+/g, " ").trim();
  if (bare.length > 1 && bare.toLowerCase() !== query.toLowerCase()) return bare;
  const words = query.split(/\s+/);
  return words.length > 2 ? words.slice(0, -1).join(" ") : null;
};

// ---- Keyboard: arrows move between results; Up from the first line goes back to the field ------

const NAV_ITEMS = ".card-face, .row-end-more";
const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const SAME_LINE = 24; // px: a hovered card lifts a little, it is still on its line

function neighbour(root, from, key) {
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const line = from.closest(".row-track, .search-grid");
    const items = line ? [...line.querySelectorAll(NAV_ITEMS)] : [];
    return items[items.indexOf(from) + (key === "ArrowRight" ? 1 : -1)] || null;
  }
  const items = [...root.querySelectorAll(NAV_ITEMS)];
  const rects = items.map(el => el.getBoundingClientRect());
  const here = from.getBoundingClientRect();
  const down = key === "ArrowDown";
  // The nearest line below (or above), then the card on it closest to this one.
  let line = null;
  rects.forEach(rect => {
    const beyond = down ? rect.top > here.top + SAME_LINE : rect.top < here.top - SAME_LINE;
    if (beyond && (line == null || (down ? rect.top < line : rect.top > line))) line = rect.top;
  });
  if (line == null) return null;
  const x = here.left + here.width / 2;
  let best = null;
  let bestDx = Infinity;
  rects.forEach((rect, i) => {
    if (Math.abs(rect.top - line) > SAME_LINE) return;
    const dx = Math.abs(rect.left + rect.width / 2 - x);
    if (dx < bestDx) { bestDx = dx; best = items[i]; }
  });
  return best;
}

export default function Search({ params }) {
  const { laterIds, toggleLater, openDetails } = useApp();
  const active = useScreenActive();
  const heroRef = useRef(null);
  const resultsRef = useRef(null);
  const filtersRef = useRef(null);
  const typeRef = useRef(null);
  const timer = useRef(0);
  const [query, setQuery] = useState(() => String(params.q ?? lastQuery).trim());
  const queryRef = useRef(query);
  queryRef.current = query;
  const [answer, setAnswer] = useState(null);
  const [kind, setKind] = useState("all");
  const [addon, setAddon] = useState(() => loadFilters().addon || "all");
  const [person, setPerson] = useState(null);
  const topic = useTopic("search", null);
  useSegmentPill(typeRef);

  // Built again with a query (going back to a search that was let go): ask for it without
  // touching the route, since this screen may not be the one on display.
  useEffect(() => {
    if (query && !answers.has(query)) call("search.query", { query }).catch(() => {});
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The search topic holds only the latest answer, shared by every search screen. This screen
  // keeps its own copy of the answer to its own query, so another search, or a slow answer to a
  // query typed earlier, never replaces what is on screen.
  useEffect(() => {
    if (!query || !topic || topic.query !== query) return;
    setAnswer(prev => {
      // The same search starting over (Try again) keeps its results until new ones come.
      if (prev?.query === query && prev.sections?.length && topic.loading && !topic.sections?.length) return prev.loading ? prev : { ...prev, loading: true };
      return topic;
    });
    if (!topic.loading && !topic.error) keepAnswer(query, topic);
  }, [topic, query]);

  const run = useCallback((text, { commit = false } = {}) => {
    window.clearTimeout(timer.current);
    const q = text.trim();
    rememberQuery(q);
    if (q === queryRef.current && !commit) return;
    if (q !== queryRef.current) setKind("all");
    setQuery(q);
    // An empty query also stops whatever the addons were still searching for.
    call("search.query", { query: q, commit: commit && q.length > 1 }).then(() => { if (commit) loadHistory(); }, () => {});
  }, []);

  const onType = useCallback(text => {
    window.clearTimeout(timer.current);
    const q = text.trim();
    if (!q) { run(""); return; }
    if (q.length > 1) timer.current = window.setTimeout(() => run(q), TYPING_MS);
  }, [run]);
  const onSubmit = useCallback(text => run(text, { commit: true }), [run]);
  const onClear = useCallback(() => run(""), [run]);

  // Left with typing still waiting (a result clicked straight away): searched on return instead.
  useEffect(() => {
    if (!active) { window.clearTimeout(timer.current); return; }
    const typed = heroRef.current?.text().trim() ?? query;
    if (typed !== query && typed.length !== 1) run(typed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Ctrl+K or / while already here: to the field, with what is in it selected.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = event => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "") || event.target?.isContentEditable;
      if (!((event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "k") || (event.key === "/" && !typing))) return;
      event.preventDefault();
      heroRef.current?.focus({ select: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);

  // People: once the query has rested a moment, so the titles get a head start.
  useEffect(() => {
    const name = personName(query);
    if (!name) return undefined;
    if (people.has(name)) { setPerson({ query, name, items: people.get(name) }); return undefined; }
    let alive = true;
    const wait = window.setTimeout(() => {
      call("people.works", { name }, { timeoutMs: 25000 }).then(result => {
        const items = Array.isArray(result?.items) ? result.items : [];
        people.set(name, items);
        if (alive) setPerson({ query, name, items });
      }, () => {});
    }, 600);
    return () => { alive = false; window.clearTimeout(wait); };
  }, [query]);

  const pending = useMemo(() => ({ query, loading: true, sections: [] }), [query]);
  const current = !query ? IDLE : answer?.query === query ? answer : answers.get(query) || pending;
  const sections = current.sections || EMPTY;
  const addons = useMemo(() => {
    const counts = new Map();
    sections.forEach(section => {
      if (!section.items?.length) return;
      const name = section.addonName || "Other";
      counts.set(name, (counts.get(name) || 0) + section.items.length);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sections]);
  // A remembered addon this search doesn't have falls back to everything.
  const addonFilter = addon !== "all" && addons.some(([name]) => name === addon) ? addon : "all";
  const groups = useMemo(() => groupResults(sections, query, addonFilter), [sections, query, addonFilter]);
  const kindFilter = kind !== "all" && groups.some(group => group.kind === kind) ? kind : "all";
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const found = person?.query === query && person.items.length ? person : null;

  const chooseAddon = value => {
    setAddon(value);
    try { localStorage.setItem(FILTERS, JSON.stringify({ ...loadFilters(), addon: value })); } catch { /* a nicety */ }
  };

  // A new filter shows its results from the top, settling in.
  const seated = useRef(false);
  useLayoutEffect(() => {
    if (!seated.current) { seated.current = true; return; }
    const bar = filtersRef.current;
    if (bar) {
      const top = bar.getBoundingClientRect().top + window.scrollY - 96;
      if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
    }
    if (reduceMotion() || !resultsRef.current) return;
    [...resultsRef.current.querySelectorAll(":scope > .row, :scope > .search-group")].slice(0, 4).forEach((node, i) => node.animate(
      [{ opacity: 0, transform: "translate3d(0, 8px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 260, delay: i * 40, easing: EASE.out, fill: "backwards" },
    ));
  }, [kindFilter, addonFilter]);

  const open = useCallback(item => {
    // Opening something from a search is what makes the search worth keeping.
    if (queryRef.current.length > 1) recordSearch(queryRef.current);
    openDetails(item);
  }, [openDetails]);

  const toResults = useCallback(() => {
    const first = resultsRef.current?.querySelector(NAV_ITEMS);
    if (!first) return false;
    first.focus();
    return true;
  }, []);
  const toField = () => {
    heroRef.current?.focus();
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
  };
  const onResultsKey = event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (ARROWS.has(event.key) && target.matches?.(NAV_ITEMS)) {
      event.preventDefault();
      const next = neighbour(resultsRef.current, target, event.key);
      if (next) next.focus();
      else if (event.key === "ArrowUp") toField();
      return;
    }
    // Typing while on a result goes on in the field (and Backspace edits it rather than leaving).
    if ((event.key.length === 1 && event.key !== " " && event.key !== "/") || event.key === "Backspace") {
      event.stopPropagation();
      toField();
    }
  };

  const suggest = text => {
    heroRef.current?.set(text);
    run(text, { commit: true });
  };
  const retry = () => {
    // The app answers a repeated query from what it already has: clear it first to ask again.
    call("search.query", { query: "" }).catch(() => {});
    call("search.query", { query }).catch(() => {});
  };

  return (
    <main className="screen search">
      <section className="search-top">
        <h1 className="sr-only">Search</h1>
        <SearchHero ref={heroRef} autoFocus={active} initial={query} onType={onType} onSubmit={onSubmit} onClear={onClear} onDown={toResults} />
        {total ? (
          <div ref={filtersRef} className="search-filters" role="toolbar" aria-label="Filter results">
            {groups.length > 1 ? (
              <div ref={typeRef} className="seg" role="group" aria-label="Kind">
                <button aria-pressed={kindFilter === "all"} onClick={() => setKind("all")}>All <span className="num search-chip-n">{total}</span></button>
                {groups.map(group => (
                  <button key={group.kind} aria-pressed={kindFilter === group.kind} onClick={() => setKind(group.kind)}>
                    {group.label} <span className="num search-chip-n">{group.items.length}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {addons.length > 1 ? (
              <div className="search-addons" role="group" aria-label="Addon">
                <button className="chip" aria-pressed={addonFilter === "all"} onClick={() => chooseAddon("all")}>All addons</button>
                {addons.map(([name, n]) => (
                  <button key={name} className="chip" aria-pressed={addonFilter === name} onClick={() => chooseAddon(addonFilter === name ? "all" : name)}>
                    <span dir="auto">{name}</span> <span className="num search-chip-n">{n}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {current.loading ? <span className="search-status" role="status">Still searching your addons</span> : null}
          </div>
        ) : null}
      </section>

      <div ref={resultsRef} className="search-results" onKeyDown={onResultsKey}>
        <Results
          query={query}
          current={current}
          groups={groups}
          kind={kindFilter}
          person={found}
          laterIds={laterIds}
          onOpen={open}
          onToggleLater={toggleLater}
          onKind={setKind}
        />
      </div>

      {query && !current.loading && !current.error && !total && !found ? <NoResults query={query} onSuggest={suggest} /> : null}

      {query && current.error && !total && !current.loading ? (
        <section className="empty">
          <h2>Search didn't work</h2>
          <p dir="auto">{current.error} Check your connection or your addons, then try again.</p>
          <button className="btn btn-glass btn-sm" onClick={retry}><LuRotateCw /> Try again</button>
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

function NoResults({ query, onSuggest }) {
  const shorter = simpler(query);
  return (
    <section className="empty">
      <h2>Nothing for “<bdi>{query}</bdi>”</h2>
      <p>Check the spelling, or try the original title, or its English or Arabic name. Search looks through the catalogs of your installed addons.</p>
      {shorter ? (
        <button className="btn btn-glass btn-sm" onClick={() => onSuggest(shorter)}>
          <LuSearch /><span>Search for “<bdi>{shorter}</bdi>”</span>
        </button>
      ) : null}
    </section>
  );
}

/**
 * What was found. Everything: a row per kind, and the person the query names. One kind: all of
 * it in a grid. Kept apart from the screen so a search topic push for another query, or a
 * keystroke, never re-renders the cards.
 */
const Results = memo(function Results({ query, current, groups, kind, person, laterIds, onOpen, onToggleLater, onKind }) {
  const card = item => (
    <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={onOpen} onToggleLater={onToggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
  );
  if (!query) return null;
  if (current.loading && !groups.length) {
    return (
      <div className="search-skeleton" aria-busy="true" aria-label="Searching">
        <span className="skel search-skeleton-title" />
        <div className="search-skeleton-cards"><SkeletonPosters count={8} /></div>
      </div>
    );
  }
  const personRow = person ? (
    <Row
      key={`person:${person.name}`}
      title={person.name}
      subtitle={`Cast and crew · ${person.items.length} ${person.items.length === 1 ? "title" : "titles"}`}
      onMore={() => navigate("person", { name: person.name, photo: null })}
      moreLabel="All their work"
    >
      {person.items.slice(0, ROW_MAX).map(card)}
    </Row>
  ) : null;
  const shown = kind === "all" ? groups : groups.filter(group => group.kind === kind);
  // One kind on its own reads best as a grid; several, as a row each.
  if (shown.length === 1 && !(kind === "all" && personRow)) {
    const group = shown[0];
    return (
      <section key={`${query}:${group.kind}`} className="search-group">
        <h2 className="row-title">{group.label} <span className="search-count num">{group.items.length}</span></h2>
        <div className="search-grid">{group.items.map(card)}</div>
      </section>
    );
  }
  return (
    <>
      {shown.map(group => (
        <Row
          key={`${query}:${group.kind}`}
          title={group.label}
          subtitle={`${group.items.length} ${group.items.length === 1 ? "title" : "titles"}`}
          onMore={group.items.length > 7 ? () => onKind(group.kind) : undefined}
          moreLabel={`See all ${group.items.length}`}
        >
          {group.items.slice(0, ROW_MAX).map(card)}
        </Row>
      ))}
      {kind === "all" ? personRow : null}
    </>
  );
});
