import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuRotateCw } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import Showcase from "../components/Showcase.jsx";
import Reach from "../components/Reach.jsx";
import Row from "../components/Row.jsx";
import { ContinueCard, PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import { CatalogRow, useToggleLater } from "../components/RowActions.jsx";
import AddonShelf from "../components/AddonShelf.jsx";
import { navigate } from "../lib/router.js";
import { EASE, reduceMotion } from "../lib/motion.js";
import { lookOf } from "../lib/look.js";
import { useSimilar } from "../lib/similar.js";
import TopTen from "../haze/TopTen.jsx";
import "./Home.css";

const NONE = [];

// How long a title taken off Continue watching can still be put back (a little longer than
// the toast that offers it stays up).
const UNDO_MS = 6400;

/**
 * Taking titles off Continue watching, with Undo. The app has no way to bring an entry back, so
 * the title is hidden at once and only removed for good once the toast offering Undo has gone.
 */
function useContinueRemoval(entries) {
  const { toast } = useApp();
  const [hidden, setHidden] = useState(() => new Set());
  const pending = useRef(new Map());
  const show = useCallback(id => setHidden(prev => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  }), []);
  const commit = useCallback((id, entry) => {
    pending.current.delete(id);
    call("continue.remove", { id: entry.id, type: entry.type }).catch(error => {
      show(id);
      toast(error.message, { tone: "error" });
    });
  }, [show, toast]);
  const remove = useCallback(entry => {
    const id = entry.id;
    if (pending.current.has(id)) return;
    setHidden(prev => new Set(prev).add(id));
    pending.current.set(id, { entry, timer: window.setTimeout(() => commit(id, entry), UNDO_MS) });
    toast(`Removed ${entry.name} from Continue watching`, {
      duration: UNDO_MS - 400,
      action: {
        label: "Undo",
        run: () => {
          const job = pending.current.get(id);
          if (!job) return;
          window.clearTimeout(job.timer);
          pending.current.delete(id);
          show(id);
        },
      },
    });
  }, [commit, show, toast]);
  // A removed title stays hidden until the app's list no longer has it; after that it can come
  // back on its own (watched again).
  useEffect(() => {
    setHidden(prev => {
      if (!prev.size) return prev;
      const listed = new Set(entries.map(entry => entry.id));
      const next = new Set([...prev].filter(id => listed.has(id) || pending.current.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);
  // Leaving for good (another profile): what was removed is removed now.
  useEffect(() => () => pending.current.forEach(({ entry, timer }, id) => { window.clearTimeout(timer); commit(id, entry); }), [commit]);
  const shown = useMemo(() => (hidden.size ? entries.filter(entry => !hidden.has(entry.id)) : entries), [entries, hidden]);
  return [shown, remove];
}

/**
 * The title to suggest from: the one watched last (in progress or finished) whose genres are
 * known from what the page already has (catalog rows, the library, My list). Suggestions are
 * found by genre, so a title without them can't seed any.
 */
const useBecauseSeed = (recentEntries, finished, sections, watchLater) => {
  const library = useTopic("library", null);
  const seed = useMemo(() => {
    const known = new Map();
    const note = item => { if (item?.genres?.length) known.set(`${item.type}:${item.id}`, item); };
    sections.forEach(section => section.items.forEach(note));
    (library?.items || []).forEach(note);
    watchLater.forEach(note);
    const recent = [
      ...recentEntries.map(entry => ({ type: entry.type, id: entry.id, name: entry.name, at: entry.lastWatched || 0 })),
      ...finished.map(item => ({ type: item.type, id: item.id, name: item.name, at: item.completedAt || 0 })),
    ].sort((a, b) => b.at - a.at).slice(0, 6);
    for (const title of recent) {
      const found = known.get(`${title.type}:${title.id}`);
      if (found) return { type: title.type, id: title.id, name: title.name, genres: found.genres, releaseInfo: found.releaseInfo || "" };
    }
    return null;
  }, [recentEntries, finished, sections, library, watchLater]);
  const key = seed ? `${seed.type}:${seed.id}` : null;
  // The same title keeps the same seed, so its row doesn't draw again with every progress save.
  return useMemo(() => seed, [key]); // eslint-disable-line react-hooks/exhaustive-deps
};

/** "Because you watched ...": titles like it that you haven't started, once there are some. */
const BecauseRow = memo(function BecauseRow({ seed, watchedIds, laterIds, onOpen, onToggleLater }) {
  const { items } = useSimilar(seed);
  const picks = useMemo(() => items.filter(item => !watchedIds.has(item.id)).slice(0, 20), [items, watchedIds]);
  if (!picks.length) return null;
  return (
    <Row title={`Because you watched ${seed.name}`} className="home-because">
      {picks.map(item => <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={onOpen} onToggleLater={onToggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />)}
    </Row>
  );
});

export default function Home() {
  const { watchLater, laterIds, openDetails, resume, appearance } = useApp();
  const toggleLater = useToggleLater();
  const haze = lookOf(appearance) === "haze";
  const home = useTopic("home", { loading: true, hero: [], sections: [] });
  const [continueWatching, removeContinue] = useContinueRemoval(useTopic("continue", NONE));
  const finished = useTopic("completed", NONE);
  // A catalog that came back empty is not a row.
  const sections = useMemo(() => home.sections.filter(section => section.items?.length), [home.sections]);
  const because = useBecauseSeed(continueWatching, finished, sections, watchLater);
  const watchedIds = useMemo(() => new Set([...continueWatching, ...finished].map(item => item.id)), [continueWatching, finished]);
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    call("home.refresh").catch(() => {}).finally(() => setRetrying(false));
  };

  useEffect(() => { call("home.subscribe").catch(() => {}); }, []);

  // Launch: as the intro lifts away, the dashboard rises into place in reading order
  // (transform only, so the glass keeps blurring the real backdrop the whole time).
  const rootRef = useRef(null);
  useEffect(() => {
    let played = false;
    const onIntroOut = () => {
      const root = rootRef.current;
      // Behind "Who's watching?" the rise would go unseen: it plays when that page lifts.
      if (played || !root || reduceMotion() || document.querySelector(".gate")) return;
      played = true;
      const parts = [root.querySelector(".showcase-body"), ...[...root.querySelectorAll(".row")].slice(0, haze ? 2 : 1)].filter(Boolean);
      parts.forEach((part, i) => part.animate(
        [{ opacity: 0, transform: "translate3d(0, 20px, 0)" }, { opacity: 1, transform: "none" }],
        { duration: 800, delay: 60 + i * 90, easing: EASE.out, fill: "backwards" },
      ));
    };
    window.addEventListener("nuvio:intro-out", onIntroOut);
    return () => window.removeEventListener("nuvio:intro-out", onIntroOut);
  }, []);

  const playFromSpotlight = item => navigate("details", { type: item.type, id: item.id, name: item.name, autoplay: true });

  // Haze: the first full catalog row is counted down as a top ten.
  const topTen = haze ? sections.find(section => section.items.length >= 10) || null : null;
  // Nothing to feature (the hero is off, no catalog loaded, a new profile with no addons): no
  // empty picture filling the window, the page starts under the bar.
  const featured = home.loading || (home.hero || []).length > 0;
  return (
    <main ref={rootRef} className={`screen home${featured ? "" : " no-hero"}`}>
      <h1 className="sr-only">Home</h1>
      {featured ? (
        <div className="home-top">
          <Showcase items={home.hero} strip={continueWatching.length > 0} onPlay={playFromSpotlight} onToggleLater={toggleLater} laterIds={laterIds} />
        </div>
      ) : null}

      {continueWatching.length ? (
        <Row title="Continue watching" className="home-strip">
          {continueWatching.map(entry => <ContinueCard key={entry.key} entry={entry} onResume={resume} onRemove={removeContinue} width={haze ? 340 : undefined} />)}
        </Row>
      ) : null}

      {/* Why the page is empty comes first, above the personal rows. */}
      {!home.loading && sections.length === 0 ? (
        home.error ? (
          <section className="home-empty" role="alert">
            <h2 className="t-title">Couldn't load your catalogs</h2>
            <p className="t-meta" dir="auto">{home.error}</p>
            <div className="home-empty-actions">
              <button className="btn btn-primary" onClick={retry} disabled={retrying}><LuRotateCw aria-hidden="true" /> {retrying ? "Trying again…" : "Try again"}</button>
              <button className="btn btn-glass" onClick={() => navigate("settings", { section: "addons" })}>Check addons</button>
            </div>
          </section>
        ) : (
          <section className="home-empty">
            <h2 className="t-title">Nothing to show yet</h2>
            <p className="t-meta">Nuvio shows what your addons bring: catalogs to browse and sources to play. Add a catalog addon (Cinemeta is the usual first one) and this page fills up.</p>
            <button className="btn btn-primary" onClick={() => navigate("settings", { section: "addons" })}>Add addons</button>
          </section>
        )
      ) : null}

      {topTen ? <TopTen section={topTen} onOpen={openDetails} /> : null}

      {because ? <BecauseRow seed={because} watchedIds={watchedIds} laterIds={laterIds} onOpen={openDetails} onToggleLater={toggleLater} /> : null}

      <Reach />

      {watchLater.length ? (
        <Row title="My list" onMore={() => navigate("library", { tab: "later" })}>
          {watchLater.map(item => <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved />)}
        </Row>
      ) : null}

      <AddonShelf />

      {sections.length === 0 && home.loading ? (
        <Row title="Loading your catalogs"><SkeletonPosters /></Row>
      ) : null}

      {sections.map(section => (section === topTen ? null : (
        <CatalogRow key={section.key} section={section} laterIds={laterIds} onOpen={openDetails} onToggleLater={toggleLater} />
      )))}

      <div className="screen-end" />
    </main>
  );
}
