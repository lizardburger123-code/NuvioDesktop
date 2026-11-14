// What the screens do differently in Lite (lib/perf.js): no decorative motion, long lists drawn a
// step at a time instead of all at once, and pictures kept in the page only while they can be seen
// soon (a decoded picture holds its memory for as long as its <img> is in the page).
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isLite, usePerf } from "./perf.js";
import { reduceMotion } from "./motion.js";
import { useScreenActive } from "./screen.js";

/** True while Lite is in force; the component draws again when it changes. */
export const useLite = () => usePerf() === "lite";

/** Decorative motion is off: the user asked for less motion, or Lite is in force. */
export const calm = () => isLite() || reduceMotion();

/** How a scroll the interface makes itself moves: smoothly, unless motion is off. */
export const scrollMotion = () => (calm() ? "auto" : "smooth");

/**
 * A long list in Lite: the first [first] items at once, then [step] more each time the end of
 * what is drawn comes within [margin] pixels of the window. Full draws everything. A new
 * [resetKey] (another search, other filters) starts again from the first step.
 * Returns { shown, more, endRef }: endRef goes on an element just after the list (it may come
 * and go: a list in a fold that opens later).
 */
export function useChunks(items, { first = 24, step = 24, margin = 600, resetKey = null } = {}) {
  const lite = useLite();
  const [chunk, setChunk] = useState({ key: resetKey, count: first });
  const [end, endRef] = useState(null);
  let { count } = chunk;
  if (chunk.key !== resetKey) {
    count = first;
    setChunk({ key: resetKey, count: first });
  }
  const more = lite && items.length > count;
  useEffect(() => {
    if (!more || !end) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setChunk(prev => ({ ...prev, count: prev.count + step }));
    }, { rootMargin: `${margin}px 0px` });
    observer.observe(end);
    return () => observer.disconnect();
  }, [more, count, step, margin, end]);
  return { shown: more ? items.slice(0, count) : items, more, endRef };
}

// ---- Near the window ---------------------------------------------------------------------------
// One observer per margin for everything that asks, however many cards that is.
const watchers = new Map();

/** Calls [onChange](inside) whenever [element] comes within [margin] of the window or leaves it. Returns the way to stop. */
export function watchNear(element, margin, onChange) {
  let watcher = watchers.get(margin);
  if (!watcher) {
    const callbacks = new Map();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => callbacks.get(entry.target)?.(entry.isIntersecting));
    }, { rootMargin: margin });
    watcher = { observer, callbacks };
    watchers.set(margin, watcher);
  }
  watcher.callbacks.set(element, onChange);
  watcher.observer.observe(element);
  return () => {
    watcher.observer.unobserve(element);
    watcher.callbacks.delete(element);
  };
}

/** How far from the window a picture stays in the page: a window and a quarter above and below. */
export const PICTURE_MARGIN = "125% 0px";

/** Watches a card's distance from the window (cards in a grid or a list). */
export const watchWindow = (element, onChange) => watchNear(element, PICTURE_MARGIN, onChange);

/**
 * Where pictures are drawn, in Lite. `on`: the screen is on display (a parked screen keeps none).
 * `watch(element, onChange)`: how a card learns whether it is near enough to keep its picture (the
 * window for a grid; for a row, the part of it scrolled into view). Full: always on, nobody watches.
 */
export const Pictures = createContext({ on: true, watch: watchWindow });

/** The value a row or a grid hands its cards, with its way of watching them; it changes only in Lite. */
export function usePicturesValue(watcher) {
  const lite = useLite();
  const active = useScreenActive();
  const on = !lite || active;
  const watch = lite ? watcher : null;
  return useMemo(() => ({ on, watch }), [on, watch]);
}

/**
 * Whether the card at [ref] has its picture in the page: always in Full; in Lite while its screen
 * is on display and its row or grid finds it near.
 */
export function usePictureShown(ref) {
  const { on, watch } = useContext(Pictures);
  const watching = Boolean(on && watch) && isLite();
  const [near, setNear] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!watching || !element) return undefined;
    return watch(element, setNear);
  }, [watching, watch, ref]);
  return on && (!watching || near);
}
