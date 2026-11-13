// Page <-> Kotlin bridge.
//
// Requests:  page posts {id, method, params}; Kotlin answers {id, result} or {id, error}.
// Pushes:    Kotlin posts {topic, data}; the latest value of every topic is cached so a screen
//            that mounts later still gets it.
// Outside the app (a plain browser) the mock backend answers instead, so the UI can be
// previewed and tested without the desktop shell.
import { createMockBackend } from "./mock/backend.js";

const webview = typeof window !== "undefined" && window.chrome && window.chrome.webview;
const forceMock = typeof location !== "undefined" && /[?&]mock\b/.test(location.search);
export const isNative = Boolean(webview) && !forceMock;

const pending = new Map();
const listeners = new Map();
const latest = new Map();
let nextId = 1;

/**
 * An error the app answered with (or a request it never answered). Its message is a sentence
 * written for people, so it can be shown as it is; `method` says which request it was.
 */
const bridgeError = (message, method, extra = {}) => Object.assign(new Error(message), { bridge: true, method }, extra);

const deliver = message => {
  if (!message || typeof message !== "object") return;
  if (message.topic) {
    latest.set(message.topic, message.data);
    const set = listeners.get(message.topic);
    if (set) for (const fn of [...set]) {
      try { fn(message.data); } catch (error) { console.error("topic", message.topic, error); }
    }
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  window.clearTimeout(entry.timer);
  if (message.error) entry.reject(bridgeError(String(message.error), entry.method));
  else entry.resolve(message.result);
};

let mock = null;
if (isNative) {
  webview.addEventListener("message", event => {
    let data = event.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch { return; }
    }
    deliver(data);
  });
} else {
  mock = createMockBackend(deliver);
}

// Every request gets an answer, even one the app never sends: after timeoutMs it fails, so no
// spinner waits forever. 45 s covers ordinary requests on a slow connection; the ones that
// legitimately take longer (installing an addon, matching subtitles, clearing TorBox, starting
// playback) pass their own limit where they are made.
export const call = (method, params = {}, { timeoutMs = 45000 } = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(bridgeError("Nuvio didn't answer in time. Try again.", method, { timeout: true }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    const message = { id, method, params };
    if (isNative) webview.postMessage(JSON.stringify(message));
    else mock.handle(message);
  });

export const on = (topic, fn) => {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic)?.delete(fn);
};

export const peek = topic => latest.get(topic);

/** Fire-and-forget notification (no reply expected). */
export const notify = (method, params = {}) => {
  const message = { id: 0, method, params };
  if (isNative) webview.postMessage(JSON.stringify(message));
  else mock.handle(message);
};
