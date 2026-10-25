// In-page navigation stack. Screens: home, browse, search, details, library, settings.
// Kotlin only ever sees "play"; everything else stays inside the page, so moving around is
// instant and keeps scroll positions.
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

let stack = [{ name: "home", params: {}, key: 1, scroll: 0 }];
let seq = 1;
let direction = 0; // 1 forward, -1 back, 0 replace
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());
// Screens cross-fade with the View Transitions API; the top bar and backdrop stay put (base.css).
const emit = () => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduce) {
    notify();
    return;
  }
  document.documentElement.dataset.nav = direction > 0 ? "forward" : direction < 0 ? "back" : "section";
  document.startViewTransition(() => flushSync(notify));
};

export const navigate = (name, params = {}, { replace = false } = {}) => {
  const top = stack[stack.length - 1];
  if (top.name === name && JSON.stringify(top.params) === JSON.stringify(params)) return;
  top.scroll = window.scrollY;
  seq += 1;
  const entry = { name, params, key: seq, scroll: 0 };
  if (replace) {
    stack = [...stack.slice(0, -1), entry];
    direction = 0;
  } else {
    stack = [...stack, entry].slice(-40);
    direction = 1;
  }
  emit();
};

/** Jump to a top-level section, clearing the history above home. */
export const goSection = (name, params = {}) => {
  const top = stack[stack.length - 1];
  if (top.name === name && JSON.stringify(top.params) === JSON.stringify(params)) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  seq += 1;
  stack = name === "home" ? [{ ...stack[0], key: seq, scroll: 0 }] : [stack[0], { name, params, key: seq, scroll: 0 }];
  direction = 0;
  emit();
};

export const back = () => {
  if (stack.length <= 1) return false;
  stack = stack.slice(0, -1);
  direction = -1;
  emit();
  return true;
};

export const canGoBack = () => stack.length > 1;

const snapshot = () => stack;
export const useStack = () => useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, snapshot);
export const currentDirection = () => direction;
