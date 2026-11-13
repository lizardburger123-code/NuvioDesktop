import { useEffect, useMemo, useRef, useState } from "react";
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
import TopTen from "../haze/TopTen.jsx";
import "./Home.css";

export default function Home() {
  const { watchLater, laterIds, openDetails, resume, removeContinue, appearance } = useApp();
  const toggleLater = useToggleLater();
  const haze = lookOf(appearance) === "haze";
  const home = useTopic("home", { loading: true, hero: [], sections: [] });
  const continueWatching = useTopic("continue", []);
  // A catalog that came back empty is not a row.
  const sections = useMemo(() => home.sections.filter(section => section.items?.length), [home.sections]);
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
