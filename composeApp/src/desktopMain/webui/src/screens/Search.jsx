import { useEffect, useRef, useState } from "react";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import SearchHero from "../components/SearchHero.jsx";
import { PosterCard, SkeletonPosters } from "../components/Cards.jsx";
import { navigate } from "../lib/router.js";
import { useScreenActive } from "../lib/screen.js";
import "./Search.css";

export default function Search({ params }) {
  const { laterIds, toggleLater, openDetails } = useApp();
  const [query, setQuery] = useState(params.q || "");
  const results = useTopic("search", { query: "", loading: false, sections: [] });
  const timer = useRef(0);
  const active = useScreenActive();

  const run = (text, { live = false } = {}) => {
    window.clearTimeout(timer.current);
    const go = () => {
      setQuery(text);
      call("search.query", { query: text, commit: !live }).catch(() => {});
      if (!live) navigate("search", { q: text }, { replace: true });
    };
    if (live) timer.current = window.setTimeout(go, 380);
    else go();
  };

  useEffect(() => {
    if (params.q) run(params.q);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = results.query === query ? results : { loading: Boolean(query), sections: [] };
  const total = current.sections.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <main className="screen search">
      <section className="search-top">
        <h1 className="t-page">Search</h1>
        <SearchHero autoFocus={active} initial={params.q || ""} onSubmit={run} compact />
      </section>

      {query && current.loading && !total ? (
        <section className="search-group"><div className="search-grid"><SkeletonPosters count={7} /></div></section>
      ) : null}

      {current.sections.map(section => (
        <section key={section.key} className="search-group">
          <h2 className="t-title">{section.title} <span className="search-count num">{section.items.length}</span></h2>
          <div className="search-grid">
            {section.items.map(item => (
              <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={openDetails} onToggleLater={toggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
            ))}
          </div>
        </section>
      ))}

      {query && !current.loading && !total ? (
        <section className="search-none">
          <h2 className="t-title">Nothing for “<span dir="auto">{query}</span>”</h2>
          <p className="t-meta">Try the original title, fewer words, or the Arabic or English name. Search covers the catalogs of your installed addons.</p>
        </section>
      ) : null}
      <div className="screen-end" />
    </main>
  );
}
