import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import { LuX } from "react-icons/lu";
import { EASE, reduceMotion } from "../lib/motion.js";
import { holdAmbient } from "../lib/hold.js";
import "./Shortcuts.css";

// Only what really works, in the words a person would use. A row may offer several combos.
const GROUPS = [
  {
    title: "Anywhere",
    rows: [
      [[["Ctrl", "K"], ["/"]], "Search"],
      [[["Esc"]], "Close what's open, or go back"],
      [[["Alt", "←"], ["Backspace"]], "Back"],
      [[["Alt", "→"]], "Forward"],
      [[["Ctrl", "Shift", "L"]], "Switch between the Cinema and Haze looks"],
      [[["?"]], "Show this list"],
    ],
  },
  {
    title: "Mouse",
    rows: [
      [[["Back button"]], "Back"],
      [[["Forward button"]], "Forward"],
    ],
  },
  {
    title: "Who's watching",
    rows: [
      [[["←", "→"]], "Choose a profile"],
      [[["Enter"]], "Open it"],
    ],
  },
];

/** The keyboard shortcuts, as a sheet over the page. Esc, the button or a click outside closes it. */
export default function Shortcuts({ onClose }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => holdAmbient(), []);
  useLayoutEffect(() => {
    // Keyboard focus comes in with the sheet and goes back where it was when it closes.
    const before = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    if (!reduceMotion()) {
      sheetRef.current?.animate(
        [{ opacity: 0, transform: "translate3d(0, 12px, 0) scale(.97)" }, { opacity: 1, transform: "none" }],
        { duration: 320, easing: EASE.out },
      );
    }
    return () => { if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    const onKey = event => {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        // One button inside: Tab stays on it.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="keys-layer" data-modal-open onClick={onClose}>
      <div ref={sheetRef} className="keys-sheet" role="dialog" aria-modal="true" aria-labelledby="keys-title" onClick={event => event.stopPropagation()}>
        <header className="keys-head">
          <h2 id="keys-title">Keyboard shortcuts</h2>
          <button ref={closeRef} className="btn btn-glass btn-icon btn-sm" onClick={onClose} aria-label="Close" title="Close (Esc)"><LuX /></button>
        </header>
        {GROUPS.map(group => (
          <section key={group.title} className="keys-group">
            <h3>{group.title}</h3>
            <dl>
              {group.rows.map(([combos, what]) => (
                <div key={what} className="keys-row">
                  <dt>
                    {combos.map((combo, i) => (
                      <Fragment key={combo.join("+")}>
                        {i ? <span className="keys-or">or</span> : null}
                        <span className="keys-combo">{combo.map(key => <kbd key={key}>{key}</kbd>)}</span>
                      </Fragment>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="keys-note">In a text field the keys type: press Esc to leave the field first. Ctrl+K and Alt with the arrows work there too.</p>
      </div>
    </div>
  );
}
