import { useEffect, useRef, useState } from "react";
import { LuArrowRight, LuHistory, LuSearch } from "react-icons/lu";
import GlassSurface from "../reactbits/GlassSurface/GlassSurface.jsx";
import { call } from "../bridge.js";
import { navigate } from "../lib/router.js";
import "./SearchHero.css";

/** The big frosted search field with the recent searches under it. */
export default function SearchHero({ autoFocus = false, initial = "", onSubmit, compact = false }) {
  const [query, setQuery] = useState(initial);
  const [history, setHistory] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    call("search.history").then(list => setHistory(Array.isArray(list) ? list.slice(0, 6) : []), () => {});
  }, []);
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  useEffect(() => { setQuery(initial); }, [initial]);

  const submit = text => {
    const q = String(text ?? query).trim();
    if (!q) return;
    if (onSubmit) onSubmit(q);
    else navigate("search", { q });
  };

  return (
    <div className={`search-hero${compact ? " search-hero-compact" : ""}`}>
      <GlassSurface
        width="100%"
        height={compact ? 54 : 62}
        borderRadius={compact ? 27 : 31}
        blur={14}
        brightness={60}
        opacity={0.9}
        backgroundOpacity={0.12}
        saturation={1.4}
        className="search-glass"
      >
        <form
          className="search-form"
          onSubmit={event => { event.preventDefault(); submit(); }}
          role="search"
        >
          <LuSearch className="search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              if (onSubmit && event.target.value.trim().length > 1) onSubmit(event.target.value.trim(), { live: true });
            }}
            placeholder="Search movies, series and anime"
            aria-label="Search"
            spellCheck={false}
            autoComplete="off"
          />
          <button className="search-go" type="submit" aria-label="Search">
            Go <LuArrowRight />
          </button>
        </form>
      </GlassSurface>
      {history.length ? (
        <div className="search-recent" aria-label="Recent searches">
          {history.map(item => (
            <button key={item} className="chip" onClick={() => { setQuery(item); submit(item); }}>
              <LuHistory aria-hidden="true" />
              <span dir="auto">{item}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
