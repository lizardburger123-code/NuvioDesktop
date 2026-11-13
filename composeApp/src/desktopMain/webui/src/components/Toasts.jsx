import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuCircleAlert } from "react-icons/lu";
import { useToastControl, useToasts } from "../AppContext.jsx";
import { EASE, reduceMotion } from "../lib/motion.js";
import "./Toasts.css";

// After a pause (pointer or focus on the stack) a note gets at least this long to be read.
const MIN_AFTER_PAUSE = 1500;

function Toast({ toast, paused, onDismiss }) {
  const ref = useRef(null);
  const remaining = useRef(toast.duration);
  const bump = useRef(toast.bump);

  useLayoutEffect(() => {
    if (reduceMotion()) return;
    ref.current.animate(
      [{ opacity: 0, transform: "translate3d(0, 14px, 0) scale(.96)" }, { opacity: 1, transform: "none" }],
      { duration: 420, easing: EASE.out },
    );
  }, []);
  useLayoutEffect(() => {
    if (!toast.leaving) return;
    ref.current.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(0, 6px, 0) scale(.98)" }],
      { duration: 220, easing: EASE.exit, fill: "forwards" },
    );
  }, [toast.leaving]);
  // The same note again: a small nudge says "yes, this again" instead of a second copy.
  useLayoutEffect(() => {
    if (!toast.bump || reduceMotion()) return;
    ref.current.animate([{ transform: "scale(1.04)" }, { transform: "none" }], { duration: 260, easing: EASE.out });
  }, [toast.bump]);

  // The clock runs only while nobody is reading or using the stack; a repeat starts it over.
  useEffect(() => {
    if (bump.current !== toast.bump) {
      bump.current = toast.bump;
      remaining.current = toast.duration;
    }
    if (paused || toast.leaving) return undefined;
    const started = performance.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), Math.max(remaining.current, 0));
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(MIN_AFTER_PAUSE, remaining.current - (performance.now() - started));
    };
  }, [paused, toast.leaving, toast.bump, toast.duration, toast.id, onDismiss]);

  const error = toast.tone === "error";
  const Icon = typeof toast.icon === "function" ? toast.icon : null;
  const icon = Icon ? <Icon aria-hidden="true" /> : toast.icon || (error ? <LuCircleAlert aria-hidden="true" /> : null);
  return (
    <div ref={ref} className={`toast${error ? " toast-error" : ""}`}>
      {icon ? <span className="toast-icon">{icon}</span> : null}
      <span className="toast-text">{toast.message}</span>
      {toast.action ? <button className="toast-action" onClick={toast.action.run}>{toast.action.label}</button> : null}
    </div>
  );
}

/**
 * The notes at the bottom of the window. Screen readers hear each one through two live regions
 * that stay in the page (errors interrupt, the rest wait their turn); the notes themselves stay
 * readable and their buttons reachable.
 */
export default function Toasts() {
  const toasts = useToasts();
  const { dismiss } = useToastControl();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  const [said, setSaid] = useState({ polite: "", alert: "" });
  const heard = useRef(new Map());
  const waiting = useRef({ polite: null, alert: null });
  const stackRef = useRef(null);

  // Behind the player or minimised, nobody can read them: they wait.
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Announce each new note, and a repeat of one, exactly once.
  useEffect(() => {
    const next = new Map();
    let polite = null;
    let alert = null;
    toasts.forEach(t => {
      next.set(t.id, t.bump);
      if (t.leaving || heard.current.get(t.id) === t.bump) return;
      const line = t.action ? `${t.message} (${t.action.label} is available)` : t.message;
      if (t.tone === "error") alert = line;
      else polite = line;
    });
    heard.current = next;
    if (polite == null && alert == null) return undefined;
    // Kept until spoken: two notes inside one frame must not cancel each other.
    if (polite != null) waiting.current.polite = polite;
    if (alert != null) waiting.current.alert = alert;
    // Emptied first, so the same words twice are still read twice.
    setSaid(now => ({ polite: polite != null ? "" : now.polite, alert: alert != null ? "" : now.alert }));
    const frame = window.requestAnimationFrame(() => {
      const words = waiting.current;
      waiting.current = { polite: null, alert: null };
      setSaid(now => ({ polite: words.polite ?? now.polite, alert: words.alert ?? now.alert }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [toasts]);

  // A note that leaves takes its pointer and focus with it (a removed button never blurs).
  useEffect(() => {
    if (!stackRef.current?.contains(document.activeElement)) setFocused(false);
    if (!toasts.length) setHovered(false);
  }, [toasts]);

  return (
    <>
      <div
        ref={stackRef}
        className="toasts"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      >
        {toasts.map(toast => <Toast key={toast.id} toast={toast} paused={hovered || focused || hidden} onDismiss={dismiss} />)}
      </div>
      <div className="sr-only" role="status" aria-live="polite">{said.polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive">{said.alert}</div>
    </>
  );
}
