import { useLayoutEffect, useRef } from "react";
import { useToasts } from "../AppContext.jsx";
import { EASE, reduceMotion } from "../lib/motion.js";
import "./Toasts.css";

function Toast({ toast }) {
  const ref = useRef(null);
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
  return (
    <div ref={ref} className={`toast glass-dark${toast.tone === "error" ? " toast-error" : ""}`} role="status">
      <span>{toast.message}</span>
      {toast.action ? <button className="toast-action" onClick={toast.action.run}>{toast.action.label}</button> : null}
    </div>
  );
}

export default function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(toast => <Toast key={toast.id} toast={toast} />)}
    </div>
  );
}
