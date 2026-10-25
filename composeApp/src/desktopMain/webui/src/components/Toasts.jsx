import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { useApp } from "../AppContext.jsx";
import "./Toasts.css";

function Toast({ toast }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    gsap.fromTo(ref.current, { y: 16, scale: 0.94, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.45, ease: "back.out(1.6)" });
  }, []);
  return (
    <div ref={ref} className={`toast glass-dark${toast.tone === "error" ? " toast-error" : ""}`} role="status">
      {toast.message}
    </div>
  );
}

export default function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(toast => <Toast key={toast.id} toast={toast} />)}
    </div>
  );
}
