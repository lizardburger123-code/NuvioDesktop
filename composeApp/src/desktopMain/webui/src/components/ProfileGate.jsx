import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuLoaderCircle, LuLock } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { EASE, reduceMotion } from "../lib/motion.js";
import { Avatar } from "./ProfileCard.jsx";
import "./ProfileGate.css";

const PASSED = "nuvio.gate.passed";
const passed = () => { try { return sessionStorage.getItem(PASSED) === "1"; } catch { return false; } };
const markPassed = () => { try { sessionStorage.setItem(PASSED, "1"); } catch { /* ignore */ } };

/** Whether the "Who's watching?" page should open on this launch. */
export const shouldShowGate = boot => boot?.appearance?.profileGate !== false && (boot?.profiles || []).length > 0 && !passed();

/**
 * "Who's watching?" — the first page after the intro. Picking your profile opens Home; picking
 * another switches to it.
 */
export default function ProfileGate({ onDone }) {
  const { boot, profile, toast, setAppearance } = useApp();
  const [leaving, setLeaving] = useState(null);
  const ref = useRef(null);
  const listRef = useRef(null);
  const profiles = (boot.profiles || []).map(p => (p.id === profile?.id ? { ...p, avatar: profile.avatar || p.avatar, color: profile.color || p.color } : p));

  // Profiles rise in one after another once the intro has lifted.
  useLayoutEffect(() => {
    if (!listRef.current || reduceMotion()) return;
    const items = [...listRef.current.querySelectorAll(".gate-profile")];
    items.forEach((node, i) => node.animate(
      [{ opacity: 0, transform: "translate3d(0, 24px, 0) scale(.94)" }, { opacity: 1, transform: "none" }],
      { duration: 620, delay: 1500 + i * 70, easing: EASE.out, fill: "backwards" },
    ));
    ref.current.querySelectorAll(".gate-title, .gate-foot").forEach((node, i) => node.animate(
      [{ opacity: 0, transform: "translate3d(0, 12px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 600, delay: 1400 + i * 400, easing: EASE.out, fill: "backwards" },
    ));
  }, []);

  useEffect(() => {
    const first = listRef.current?.querySelector(`[data-id="${profile?.id}"]`) || listRef.current?.querySelector(".gate-profile:not(:disabled)");
    const timer = window.setTimeout(() => first?.focus({ preventScroll: true }), 1600);
    const onKey = event => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const buttons = [...(listRef.current?.querySelectorAll(".gate-profile:not(:disabled)") || [])];
      const at = buttons.indexOf(document.activeElement);
      const next = buttons[(at + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
      next?.focus();
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [profile?.id]);

  const finish = id => {
    markPassed();
    if (!ref.current || reduceMotion()) { onDone(); window.requestAnimationFrame(() => window.dispatchEvent(new Event("nuvio:intro-out"))); return; }
    const chosen = listRef.current.querySelector(`[data-id="${id}"]`);
    listRef.current.querySelectorAll(".gate-profile").forEach(node => {
      if (node !== chosen) node.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.92)" }], { duration: 260, easing: EASE.exit, fill: "forwards" });
    });
    chosen?.animate([{ transform: "none" }, { transform: "scale(1.12)" }], { duration: 520, easing: EASE.out, fill: "forwards" });
    ref.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 260, easing: EASE.exit, fill: "forwards" }).onfinish = () => {
      onDone();
      // Home rises into place now that it's seen (after this page has left the DOM).
      window.requestAnimationFrame(() => window.dispatchEvent(new Event("nuvio:intro-out")));
    };
  };

  const pick = async target => {
    if (leaving || target.pin) return;
    if (target.id === profile?.id) { setLeaving(target.id); finish(target.id); return; }
    setLeaving(target.id);
    try {
      await call("profiles.switch", { id: target.id });
      markPassed();
      window.location.reload();
    } catch (error) {
      toast(error.message, { tone: "error" });
      setLeaving(null);
    }
  };

  return (
    <div ref={ref} className="gate" role="dialog" aria-label="Who's watching?" data-modal-open>
      <h1 className="gate-title">Who's watching?</h1>
      <div ref={listRef} className="gate-list">
        {profiles.map(p => (
          <button
            key={p.id}
            data-id={p.id}
            className={`gate-profile${p.id === profile?.id ? " is-current" : ""}`}
            onClick={() => pick(p)}
            disabled={Boolean(p.pin) || (leaving != null && leaving !== p.id)}
            title={p.pin ? "This profile has a PIN: open it from the classic profile picker" : undefined}
          >
            <span className="gate-ring">
              <Avatar profile={p} size={132} />
              {p.pin ? <span className="gate-lock"><LuLock /></span> : null}
              {leaving === p.id && p.id !== profile?.id ? <span className="gate-busy"><LuLoaderCircle className="spin" /></span> : null}
            </span>
            <span className="gate-name" dir="auto">{p.name}</span>
          </button>
        ))}
      </div>
      <div className="gate-foot">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setAppearance({ profileGate: false }); toast("Nuvio will open straight to Home. Turn this back on in Settings › Profile."); finish(profile?.id); }}
        >
          Don't ask at launch
        </button>
      </div>
    </div>
  );
}
