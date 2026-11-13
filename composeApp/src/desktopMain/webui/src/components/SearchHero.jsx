import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { LuArrowRight, LuHistory, LuSearch, LuX } from "react-icons/lu";
import { EASE, reduceMotion } from "../lib/motion.js";
import { clearHistory, removeHistory, useSearchHistory } from "../lib/searchHistory.js";
import "./SearchHero.css";

/**
 * Search is typed straight into the page, in title type, with the recent searches under an empty
 * field. What is typed stays in here, so a keystroke never re-renders the results: the screen
 * hears about it through onType and decides when to search.
 */
const SearchHero = forwardRef(function SearchHero({ autoFocus = false, initial = "", onType, onSubmit, onClear, onDown }, ref) {
  const [text, setText] = useState(initial);
  const history = useSearchHistory().slice(0, 6);
  const inputRef = useRef(null);
  const recentRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus: ({ select = false } = {}) => {
      const input = inputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      if (select) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    },
    set: value => setText(value),
    text: () => inputRef.current?.value ?? "",
  }), []);

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
    // Back from a title, the screen has put focus on the result it was opened from: it stays
    // there, so Esc goes on back instead of emptying the search.
    const at = document.activeElement;
    if (at && at !== document.body && inputRef.current?.closest(".screen-host")?.contains(at) && !at.hasAttribute("data-nav-focus")) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const change = value => {
    setText(value);
    onType(value);
  };
  const clear = () => {
    setText("");
    onClear();
    inputRef.current?.focus({ preventScroll: true });
  };
  const submit = value => {
    const q = String(value ?? text).trim();
    if (q) onSubmit(q);
  };

  return (
    <div className="search-hero">
      <form className="search-form" onSubmit={event => { event.preventDefault(); submit(); }} role="search">
        <LuSearch className="search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="search-input"
          value={text}
          onChange={event => change(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Escape" && text) {
              // Esc empties the field first; on an empty field it does what it does everywhere.
              event.preventDefault();
              event.stopPropagation();
              clear();
            } else if (event.key === "ArrowDown" && onDown?.()) {
              event.preventDefault();
            }
          }}
          placeholder="Search films, series and anime"
          aria-label="Search"
          spellCheck={false}
          autoComplete="off"
          dir="auto"
        />
        {text ? (
          <>
            <button className="search-tool" type="button" aria-label="Clear the search" title="Clear (Esc)" onClick={clear}><LuX /></button>
            <button className="search-go" type="submit" aria-label="Search" title="Search"><LuArrowRight /></button>
          </>
        ) : null}
      </form>
      {!text && history.length ? (
        <div ref={recentRef} className="search-recent" role="group" aria-label="Recent searches">
          {history.map(item => (
            <span key={item} className="recent-chip">
              <button className="chip recent-go" onClick={() => { setText(item); submit(item); }}>
                <LuHistory aria-hidden="true" />
                <span dir="auto">{item}</span>
              </button>
              <button className="recent-x" onClick={event => forget(event, item)} aria-label={`Remove ${item} from recent searches`} title="Remove">
                <LuX />
              </button>
            </span>
          ))}
          <button className="recent-clear" onClick={forgetAll} aria-label="Clear recent searches">Clear</button>
        </div>
      ) : null}
    </div>
  );
});

export default SearchHero;
