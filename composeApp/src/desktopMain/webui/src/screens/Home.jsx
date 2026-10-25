import { useEffect } from "react";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import SearchHero from "../components/SearchHero.jsx";
import Dock from "../components/Dock.jsx";
import Row from "../components/Row.jsx";
import { ContinueCard, PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import { ResumeTile, SpotlightTile, UpNextTile, WatchLaterTile } from "../components/Tiles.jsx";
import { navigate } from "../lib/router.js";
import "./Home.css";

export default function Home() {
  const { watchLater, laterIds, toggleLater, openDetails, resume } = useApp();
  const home = useTopic("home", { loading: true, hero: [], sections: [] });
  const continueWatching = useTopic("continue", []);
  const upcoming = useTopic("upcoming", []);
  const library = useTopic("library", { items: [] });

  useEffect(() => { call("home.subscribe").catch(() => {}); }, []);

  const playFromSpotlight = item => navigate("details", { type: item.type, id: item.id, name: item.name, autoplay: true });
  const cardProps = item => ({
    item,
    onOpen: openDetails,
    onToggleLater: toggleLater,
    saved: laterIds.has(`${item.type}:${item.id}`),
  });

  return (
    <main className="screen home">
      <h1 className="sr-only">Home</h1>
      <section className="home-hero">
        <SearchHero />
        <Dock counts={{ later: watchLater.length }} />
      </section>

      <section className="home-tiles tiles" aria-label="Dashboard">
        <SpotlightTile items={home.hero} onPlay={playFromSpotlight} />
        <ResumeTile entry={continueWatching[0]} onResume={resume} />
        <WatchLaterTile items={watchLater} />
        <UpNextTile upcoming={upcoming} libraryCount={library.items?.length || 0} />
      </section>

      {continueWatching.length ? (
        <Row title="Continue watching" subtitle={`${continueWatching.length} in progress`}>
          {continueWatching.map(entry => <ContinueCard key={entry.key} entry={entry} onResume={resume} />)}
        </Row>
      ) : null}

      {watchLater.length ? (
        <Row title="Watch later" action={<button className="btn btn-ghost btn-sm" onClick={() => navigate("library", { tab: "later" })}>See all</button>}>
          {watchLater.map(item => <PosterCard key={`${item.type}:${item.id}`} {...cardProps(item)} />)}
        </Row>
      ) : null}

      {home.sections.length === 0 && home.loading ? (
        <Row title="Loading your catalogs"><SkeletonPosters /></Row>
      ) : null}

      {home.sections.map(section => (
        <Row key={section.key} title={section.title} subtitle={section.addonName}>
          {section.items.map(item => <PosterCard key={`${item.type}:${item.id}`} {...cardProps(item)} />)}
        </Row>
      ))}

      {!home.loading && home.sections.length === 0 ? (
        <section className="home-empty">
          <h2 className="t-title">No catalogs yet</h2>
          <p className="t-meta">Install an addon with catalogs (Cinemeta, Anime Kitsu) in Settings, then come back.</p>
          <button className="btn btn-primary" onClick={() => navigate("settings", { section: "addons" })}>Open addons</button>
        </section>
      ) : null}
      <div className="screen-end" />
    </main>
  );
}
