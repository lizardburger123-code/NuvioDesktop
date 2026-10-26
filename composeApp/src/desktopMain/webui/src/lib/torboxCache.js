// "Cache on TorBox": torrents sent from the sources list, and how far along they are. Kept at
// module level so a download keeps showing its progress when the sheet is closed and reopened.
import { useSyncExternalStore } from "react";
import { call } from "../bridge.js";

const state = { connected: null, items: {}, sending: new Set(), names: {} };
let version = 0;
const listeners = new Set();
const emit = () => { version += 1; listeners.forEach(fn => fn()); };
const readyListeners = new Set();

export const useTorboxCache = () => useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => version);
export const cacheItem = hash => state.items[hash] || null;
export const isSending = hash => state.sending.has(hash);
export const torboxConnected = () => state.connected;
/** Called with the title of a torrent the moment TorBox finishes it. */
export const onCacheReady = fn => { readyListeners.add(fn); return () => readyListeners.delete(fn); };

const merge = items => {
  Object.entries(items || {}).forEach(([hash, item]) => {
    const was = state.items[hash];
    state.items[hash] = item;
    if (was && !was.ready && item.ready) readyListeners.forEach(fn => fn(state.names[hash] || "Your download"));
  });
};

export async function refreshCache(hashes) {
  const list = [...new Set(hashes)].filter(Boolean);
  if (!list.length) return;
  const result = await call("torbox.cacheStatus", { hashes: list }, { timeoutMs: 30000 });
  state.connected = result?.connected !== false;
  merge(result?.items);
  emit();
}

export async function sendToTorbox(hash, name) {
  state.sending.add(hash);
  state.names[hash] = name || state.names[hash];
  emit();
  try {
    const result = await call("torbox.cache", { hash, name }, { timeoutMs: 45000 });
    state.connected = true;
    merge(result?.items);
    if (!state.items[hash]) state.items[hash] = { state: "queued", progress: 0, ready: false };
  } finally {
    state.sending.delete(hash);
    emit();
  }
}

export const etaText = seconds => {
  if (!seconds || seconds < 0 || seconds > 7 * 86400) return "";
  if (seconds < 60) return "< 1 min";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
