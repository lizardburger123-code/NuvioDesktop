// What the screens do differently in Lite (lib/perf.js): no decorative motion, and long lists
// drawn a step at a time instead of all at once.
import { useEffect, useRef, useState } from "react";
import { isLite, usePerf } from "./perf.js";
import { reduceMotion } from "./motion.js";

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
 * Returns { shown, more, endRef }: endRef goes on an element just after the list.
 */
export function useChunks(items, { first = 24, step = 24, margin = 600, resetKey = null } = {}) {
  const lite = useLite();
  const [chunk, setChunk] = useState({ key: resetKey, count: first });
  let { count } = chunk;
  if (chunk.key !== resetKey) {
    count = first;
    setChunk({ key: resetKey, count: first });
  }
  const more = lite && items.length > count;
  const endRef = useRef(null);
  useEffect(() => {
    const node = endRef.current;
    if (!more || !node) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setChunk(prev => ({ ...prev, count: prev.count + step }));
    }, { rootMargin: `${margin}px 0px` });
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, count, step, margin]);
  return { shown: more ? items.slice(0, count) : items, more, endRef };
}
