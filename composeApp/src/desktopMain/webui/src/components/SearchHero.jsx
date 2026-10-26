import { useEffect, useRef, useState } from "react";
import { LuArrowRight, LuHistory, LuSearch, LuX } from "react-icons/lu";
import GlassSurface from "../reactbits/GlassSurface/GlassSurface.jsx";
import { navigate } from "../lib/router.js";
import { EASE, reduceMotion } from "../lib/motion.js";
import { clearHistory, removeHistory, useSearchHistory } from "../lib/searchHistory.js";
import "./SearchHero.css";

/** The big frosted search field with the recent searches under it. */
export default function SearchHero({ autoFocus = false, initial = "", onSubmit, compact = false }) {
  const [query, setQuery] = useState(initial);
  const history = useSearchHistory().slice(0, 6);
  const inputRef = useRef(null);
  const recentRef = useRef(null);

  // A removed search folds away before the list closes the gap.
  const forget = (event, item) => {
    event.stopPropagation();
    const chip = event.currentTarget.closest(".recent-chip");
    if (!chip || reduceMotion()) { removeHistory(item); return; }
    chip.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.85)" }],
      { duration: 160, easing: EASE.exit, fill: "forwards" },
    ).onfinish = () => removeHistory(item);
  };
  const forgetAll = () => {
    const chips = recentRef.current ? [...recentRef.current.querySelectorAll(".recent-chip")] : [];
    if (!chips.length || reduceMotion()) { clearHistory(); return; }
    const last = chips.map((chip, i) => chip.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(0, 4px, 0) scale(.9)" }],
      { duration: 180, delay: i * 25, easing: EASE.exit, fill: "forwards" },
    )).pop();
    last.onfinish = () => clearHistory();
  };
  // Coming back to search from a title must not yank the page up to the box: focus without
  // scrolling, and only when the box is on screen anyway.
  useEffect(() => {
    if (!autoFocus || window.scrollY > 160) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
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
        <div ref={recentRef} className="search-recent" aria-label="Recent searches">
          {history.map(item => (
            <span key={item} className="recent-chip">
              <button className="chip recent-go" onClick={() => { setQuery(item); submit(item); }}>
                <LuHistory aria-hidden="true" />
                <span dir="auto">{item}</span>
              </button>
              <button className="recent-x" onClick={event => forget(event, item)} aria-label={`Remove ${item} from recent searches`} title="Remove">
                <LuX />
              </button>
            </span>
          ))}
          <button className="recent-clear" onClick={forgetAll}>Clear</button>
        </div>
      ) : null}
    </div>
  );
}
