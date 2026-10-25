// Recent searches, shared by every search field (Home's and Search's stay in step).
import { useEffect, useState } from "react";
import { call } from "../bridge.js";

let list = null;
const listeners = new Set();
const set = next => {
  list = Array.isArray(next) ? next : [];
  listeners.forEach(fn => fn(list));
};

export const loadHistory = () => call("search.history").then(set, () => {});

export const removeHistory = query => {
  set((list || []).filter(item => item !== query));
  return call("search.history.remove", { query }).then(set, () => loadHistory());
};

export const clearHistory = () => {
  set([]);
  return call("search.history.clear").catch(() => loadHistory());
};

export const useSearchHistory = () => {
  const [value, setValue] = useState(list || []);
  useEffect(() => {
    listeners.add(setValue);
    if (list === null) loadHistory();
    else setValue(list);
    return () => listeners.delete(setValue);
  }, []);
  return value;
};
