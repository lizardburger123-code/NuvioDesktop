import { useSyncExternalStore } from "react";

// Performance mode. "lite" drops the costly visuals (blur, glass, big shadows, motion, artwork
// colour) and keeps less in memory, for modest computers; "full" is the interface as designed.
//
// The user's choice is the appearance setting `performance`: "auto" | "lite" | "full". "auto"
// follows what the app found out about the computer: the bootstrap's `device.lowEnd`.
// The mode in force is <html data-perf="lite|full">. It is remembered so the next launch's first
// frame already has it, as the look is.

const KEY = "nuvio.perf";
const listeners = new Set();

/** The mode a choice comes to on this computer. */
export const resolvePerf = (choice, device) =>
  choice === "lite" ? "lite" : choice === "full" ? "full" : device?.lowEnd ? "lite" : "full";

/** The mode in force now: "lite" or "full". */
export const perfMode = () => (document.documentElement.dataset.perf === "lite" ? "lite" : "full");

export const isLite = () => perfMode() === "lite";

/** The mode the last launch ended in, for the first frame. */
export function rememberedPerf() {
  try { return window.localStorage.getItem(KEY) === "lite" ? "lite" : "full"; } catch { return "full"; }
}

/** Puts a mode in force and tells everything that follows it. */
export function applyPerf(mode) {
  const next = mode === "lite" ? "lite" : "full";
  const root = document.documentElement;
  try { window.localStorage.setItem(KEY, next); } catch { /* a nicety */ }
  if (root.dataset.perf === next) return;
  root.dataset.perf = next;
  listeners.forEach(listener => listener(next));
}

const subscribe = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The mode in force, re-rendering when it changes. */
export const usePerf = () => useSyncExternalStore(subscribe, perfMode, () => "full");
