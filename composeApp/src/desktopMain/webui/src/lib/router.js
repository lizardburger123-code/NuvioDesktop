// In-page navigation. Screens: home, browse, search, details, library, settings.
// Kotlin only ever sees "play"; everything else stays inside the page.
//
// Screens are kept alive: home always, the last few sections you visited, and the screens under
// the top of the stack. Going back or returning to a tab reveals the screen as you left it (same
// scroll, same row positions, nothing reloads) instead of rebuilding it.
//
// Every move runs as a View Transition: the old view becomes a snapshot that dissolves over the
// live new one (see base.css), the nav pill stays live on top, and a card you opened launches
// toward you (and lands back when you return). Clicks pass straight through the transition.
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { reduceMotion } from "./motion.js";

/** Order of the sections in the top bar; screen motion follows it left/right. */
export const NAV_ORDER = ["home", "browse:movie", "browse:series", "browse:anime", "library", "settings"];

const KEEP_SECTIONS = 4; // visited sections kept mounted besides home
const KEEP_UNDER = 3; // pushed screens kept mounted under the top one

export const sectionId = entry => (entry ? (entry.name === "browse" ? `browse:${entry.params?.kind}` : entry.name) : null);
const same = (a, b) => a.name === b.name && JSON.stringify(a.params || {}) === JSON.stringify(b.params || {});

let seq = 1;
let navId = 0;
// stack is the history, oldest first (like a browser); future holds pages you went back from.
let state = {
  stack: [{ name: "home", params: {}, key: 1, scroll: 0 }],
  future: [],
  sections: null,
  nav: { id: 0, kind: "none", dir: 0 },
};
state.sections = [state.stack[0]];

const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());
const subscribe = fn => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useRouter = () => useSyncExternalStore(subscribe, () => state);
export const useStack = () => useRouter().stack;
export const canGoBack = () => state.stack.length > 1;
export const canGoForward = () => state.future.length > 0;

const top = () => state.stack[state.stack.length - 1];
const saveScroll = () => { top().scroll = window.scrollY; };

/** The section the user is "in": the nearest top-bar section under the top of the stack. */
export const activeSection = stack => {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const id = sectionId(stack[i]);
    if (stack[i].name === "search") return "search";
    if (NAV_ORDER.includes(id)) return id;
  }
  return "home";
};

/** Screens to keep mounted, in creation order so the DOM never reorders (that would lose scroll). */
export const aliveEntries = router => {
  const map = new Map();
  router.sections.forEach(entry => map.set(entry.key, entry));
  router.stack.slice(-1 - KEEP_UNDER).forEach(entry => map.set(entry.key, entry));
  // The page you just went back from stays ready, so Forward is instant too.
  router.future.slice(0, 1).forEach(entry => map.set(entry.key, entry));
  return [...map.values()].sort((a, b) => a.key - b.key);
};

// ---- Where the user pressed: spatial origin for the next transition ---------------------------

let lastPress = { t: 0 };
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", event => {
    const card = event.target?.closest?.("[data-card]") || null;
    lastPress = { x: event.clientX, y: event.clientY, t: performance.now(), card };
  }, { capture: true, passive: true });
}
const recentPress = () => (performance.now() - lastPress.t < 1500 ? lastPress : null);

// ---- Transitions ------------------------------------------------------------------------------

let transition = null;
let pending = null;
let heroNode = null;

const setHero = node => {
  clearHero();
  if (!node?.isConnected) return;
  const target = node.querySelector("[data-hero]") || node.querySelector(".tilted-card__body") || node;
  const rect = target.getBoundingClientRect();
  // Only when the card is actually on screen.
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width < 8) return;
  target.style.viewTransitionName = "hero";
  heroNode = target;
};
const clearHero = () => {
  if (heroNode) heroNode.style.viewTransitionName = "";
  heroNode = null;
};

/** Fired right before the screens change, while the old screen is still laid out. */
export const BEFORE_NAV = "nuvio:before-nav";
const beforeNav = () => window.dispatchEvent(new Event(BEFORE_NAV));

const commit = next => {
  const root = document.documentElement;
  const animate = next.nav.kind !== "replace"
    && typeof document.startViewTransition === "function"
    && !reduceMotion()
    && document.visibilityState === "visible";
  if (!animate) {
    beforeNav();
    state = next;
    flushSync(notify);
    return;
  }
  if (transition) {
    // A transition is already dissolving: swap the target before it captures, or ride along.
    if (pending) pending = next;
    else {
      beforeNav();
      state = next;
      flushSync(notify);
    }
    return;
  }
  pending = next;
  root.dataset.nav = next.nav.kind;
  if (next.nav.kind === "forward" && next.nav.card && next.stack[next.stack.length - 1].name === "details") setHero(next.nav.card);
  window.dispatchEvent(new CustomEvent("nuvio:transition", { detail: true }));
  transition = document.startViewTransition(() => {
    beforeNav();
    state = pending;
    pending = null;
    root.dataset.nav = state.nav.kind;
    clearHero();
    flushSync(notify);
    // Returning from a title: the card it was opened from lands back in place.
    if (state.nav.kind === "back" && state.nav.card) setHero(state.nav.card);
  });
  transition.finished.finally(() => {
    transition = null;
    clearHero();
    delete root.dataset.nav;
    window.dispatchEvent(new CustomEvent("nuvio:transition", { detail: false }));
  });
};

export const transitionActive = () => Boolean(transition);

// ---- Public navigation ------------------------------------------------------------------------

export const navigate = (name, params = {}, { replace = false } = {}) => {
  const current = top();
  const target = { name, params };
  if (same(current, target)) return;
  saveScroll();
  navId += 1;
  if (replace && current.name === name) {
    // Same screen, new params (search query, settings page, library tab): no remount, no transition.
    const updated = { ...current, params };
    commit({
      stack: state.stack.map(entry => (entry === current ? updated : entry)),
      future: state.future,
      sections: state.sections.map(entry => (entry === current ? updated : entry)),
      nav: { id: navId, kind: "replace", dir: 0 },
    });
    return;
  }
  seq += 1;
  const press = recentPress();
  const entry = { name, params, key: seq, scroll: 0, card: press?.card || null };
  const stack = replace ? [...state.stack.slice(0, -1), entry] : [...state.stack, entry].slice(-40);
  commit({
    stack,
    future: [],
    sections: state.sections,
    nav: { id: navId, kind: replace ? "section" : "forward", dir: 0, card: entry.card },
  });
};

const MAX_HISTORY = 40;
const directionBetween = (fromStack, toEntry) => {
  const from = NAV_ORDER.indexOf(activeSection(fromStack));
  const to = NAV_ORDER.indexOf(sectionId(toEntry));
  return from >= 0 && to >= 0 ? Math.sign(to - from) : 0;
};
const isSection = entry => entry && (entry.name === "search" || NAV_ORDER.includes(sectionId(entry)));

/**
 * Jump to a top-level section. It goes on the history like any page (so Back returns to where
 * you were), and a section you visited before comes back exactly as you left it.
 */
export const goSection = (name, params = {}) => {
  const target = { name, params };
  // A section is the same section whatever its view state (Discover filters, settings page).
  const sameSection = e => (name === "settings" || name === "search" ? same(e, target) : sectionId(e) === sectionId(target));
  if (sameSection(top())) {
    window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
    return;
  }
  saveScroll();
  const home = state.sections[0];
  let entry = name === "home" ? home : state.sections.find(sameSection);
  if (!entry) {
    seq += 1;
    entry = { name, params, key: seq, scroll: 0 };
  }
  const others = state.sections.slice(1).filter(e => e !== entry);
  const sections = [home, ...[...others, ...(entry === home ? [] : [entry])].slice(-KEEP_SECTIONS)];
  navId += 1;
  commit({
    stack: [...state.stack, entry].slice(-MAX_HISTORY),
    future: [],
    sections,
    nav: { id: navId, kind: "section", dir: directionBetween(state.stack, entry) },
  });
};

/** The previous page, whatever it was: a section, a title, search. */
export const back = () => {
  if (state.stack.length <= 1) return false;
  const leaving = top();
  saveScroll();
  const stack = state.stack.slice(0, -1);
  const arriving = stack[stack.length - 1];
  navId += 1;
  // Between two sections the screens slide like the tab pill; leaving a title it settles back.
  const sideways = isSection(leaving) && isSection(arriving);
  commit({
    stack,
    future: [leaving, ...state.future].slice(0, MAX_HISTORY),
    sections: state.sections,
    nav: sideways
      ? { id: navId, kind: "section", dir: directionBetween(state.stack, arriving) }
      : { id: navId, kind: "back", dir: -1, card: leaving.card || null },
  });
  return true;
};

/** Undo a Back (mouse forward button, Alt+Right). */
export const forward = () => {
  if (!state.future.length) return false;
  saveScroll();
  const [arriving, ...future] = state.future;
  navId += 1;
  commit({
    stack: [...state.stack, arriving].slice(-MAX_HISTORY),
    future,
    sections: state.sections,
    nav: isSection(arriving)
      ? { id: navId, kind: "section", dir: directionBetween(state.stack, arriving) }
      : { id: navId, kind: "forward", dir: 0, card: arriving.card || null },
  });
  return true;
};
