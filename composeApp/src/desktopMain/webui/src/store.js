import { useEffect, useState, useSyncExternalStore } from "react";
import { call, on, peek } from "./bridge.js";

/** Latest value pushed on a bridge topic. */
export const useTopic = (topic, fallback) => {
  const value = useSyncExternalStore(
    notify => on(topic, notify),
    () => peek(topic),
  );
  return value === undefined ? fallback : value;
};

/** Run a bridge request when inputs change; returns {data, error, loading}. */
export const useCall = (method, params, deps) => {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState(prev => ({ ...prev, loading: true, error: null }));
    call(method, params).then(
      data => alive && setState({ data, error: null, loading: false }),
      error => alive && setState({ data: undefined, error, loading: false }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
};
