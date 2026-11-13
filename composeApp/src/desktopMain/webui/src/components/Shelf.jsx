import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuPlay, LuInfo, LuTrash2 } from "react-icons/lu";
import { year } from "../lib/format.js";
import { reduceMotion } from "../lib/motion.js";
import { fmtHours } from "../lib/trophies.js";
import { settle, spring, stop, wake } from "../lib/springs.js";
import "./Shelf.css";

/** The angle a picked-up case rests at: turned a little, so its spine shows. */
const FACE = -20;
const LEAN = { ry: { k: 0.11, d: 0.74 }, ty: { k: 0.12, d: 0.72 } };
const LIFT = { all: { k: 0.1, d: 0.72 }, rx: { k: 0.12, d: 0.7 }, ry: { k: 0.09, d: 0.76 } };

const finishedOn = ms => new Date(ms).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
const lengthOf = item => (item.type === "series"
  ? (item.episodes ? `${item.episodes} episodes` : "Series")
  : item.durationMs ? fmtHours(item.durationMs) : null);

/** The faces of a Blu-ray case. The back is only drawn on the one in your hands. */
function CaseFaces({ item, full }) {
  const meta = [year(item.releaseInfo), lengthOf(item)].filter(Boolean).join(" · ");
  return (
    <>
      <span className="bd-cover">
        <span className="bd-band" />
        <span className="bd-art">
          {item.poster ? <img src={item.poster} alt="" loading="lazy" decoding="async" draggable="false" /> : <span className="bd-blank" dir="auto">{item.name}</span>}
        </span>
      </span>
      <span className="bd-spine"><span dir="auto">{item.name}</span></span>
      <span className="bd-edge" />
      <span className="bd-top" />
      {full ? (
        <>
          <span className="bd-bottom" />
          <span className="bd-back">
            <span className="bd-band" />
            <span className="bd-blurb">
              {item.poster ? <img className="bd-blurb-art" src={item.poster} alt="" draggable="false" /> : null}
              <strong dir="auto">{item.name}</strong>
              <span>Finished {finishedOn(item.completedAt || Date.now())}</span>
              {meta ? <span className="num">{meta}</span> : null}
              <em>{item.type === "series" ? "Every episode watched" : "Watched to the end"}</em>
              <i className="bd-code" />
            </span>
          </span>
        </>
      ) : null}
    </>
  );
}

/** One shelf: its cases lean away from the pointer, like running a finger along them. */
function ShelfRow({ items, away, onLift }) {
  const rowRef = useRef(null);
  const bodies = useRef(new Map());
  // Where each case stands, in page coordinates: read once as the pointer arrives instead of
  // on every move (a month can hold hundreds of cases).
  const spots = useRef(null);

  const bodyFor = el => {
    let body = bodies.current.get(el);
    if (!body) {
      body = spring({ ry: 0, ty: 0 }, x => {
        el.style.setProperty("--ry", `${x.ry.toFixed(2)}deg`);
        el.style.setProperty("--ty", `${x.ty.toFixed(2)}px`);
        el.style.setProperty("--gx", `${(50 - Math.sin((x.ry * Math.PI) / 180) * 70).toFixed(1)}%`);
      }, LEAN);
      // A box (and a compositor layer) only while it leans; back upright it is a flat picture.
      body.onRest = () => { if (!body.t.ry && !body.t.ty) el.classList.remove("is-moving"); };
      bodies.current.set(el, body);
    }
    return body;
  };

  useEffect(() => () => bodies.current.forEach(stop), []);
  useEffect(() => { spots.current = null; }, [items]);

  const lean = event => {
    if (away || reduceMotion() || event.pointerType === "touch") return;
    if (!spots.current) {
      spots.current = [...(rowRef.current?.querySelectorAll(".bd-slot") || [])].map(el => {
        const r = el.getBoundingClientRect();
        return { el, x: r.left + r.width / 2 + window.scrollX, y: r.top + r.height / 2 + window.scrollY };
      });
    }
    spots.current.forEach(({ el, x, y }) => {
      const dx = event.pageX - x;
      const dy = event.pageY - y;
      const row = Math.exp(-(dy * dy) / 26000);
      let ry = Math.max(-1, Math.min(1, dx / 110)) * -17 * Math.exp(-(dx * dx) / 30000) * row;
      let ty = -12 * Math.exp(-(dx * dx) / 4200) * row;
      if (Math.abs(ry) < 0.05 && Math.abs(ty) < 0.05) { ry = 0; ty = 0; }
      const known = bodies.current.get(el);
      // Cases out of reach stay asleep: nothing to move, nothing to draw again.
      if (!known && !ry && !ty) return;
      const body = known || bodyFor(el);
      if (Math.abs(body.t.ry - ry) < 0.02 && Math.abs(body.t.ty - ty) < 0.02) return;
      body.t.ry = ry;
      body.t.ty = ty;
      el.classList.add("is-moving");
      wake(body);
    });
  };
  const rest = () => {
    spots.current = null;
    bodies.current.forEach(body => {
      if (!body.t.ry && !body.t.ty) return;
      body.t.ry = 0;
      body.t.ty = 0;
      wake(body);
    });
  };

  useEffect(() => { if (away) rest(); }, [away]);

  return (
    <div className="bd-row" ref={rowRef} onPointerMove={lean} onPointerLeave={rest}>
      {items.map(item => {
        const key = `${item.type}:${item.id}`;
        return (
          <button
            key={key}
            className={`bd-slot${away === key ? " is-away" : ""}`}
            aria-label={`${item.name}. Pick up`}
            title={item.name}
            onClick={event => onLift(item, event.currentTarget, bodies.current.get(event.currentTarget)?.x.ry || 0)}
          >
            <span className="bd-case"><CaseFaces item={item} /></span>
          </button>
        );
      })}
    </div>
  );
}

/** The case in your hands: drag to spin it, click it to turn it over, click outside to put it back. */
function Lifted({ lift, onClose, onPlay, onDetails, onRemove }) {
  const { item, slot, rect, lean } = lift;
  const stageRef = useRef(null);
  const caseRef = useRef(null);
  const primaryRef = useRef(null);
  const liftRef = useRef(null);
  const [phase, setPhase] = useState("up");
  const [layout] = useState(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wide = vw >= 880;
    const sc = Math.min(2.5, wide ? (vh - 170) / rect.height : (vh - 300) / rect.height, (vw - 80) / rect.width / (wide ? 2.2 : 1));
    const cx = wide ? vw / 2 - 180 : vw / 2;
    const cy = wide ? vh / 2 + 10 : 40 + (rect.height * sc) / 2 + 30;
    return { wide, sc, cx, cy };
  });
  const body = useRef(null);
  if (!body.current) {
    body.current = spring({ tx: 0, ty: 0, sc: 1, rx: 0, ry: lean }, x => {
      const el = stageRef.current;
      if (!el) return;
      el.style.setProperty("--tx", `${x.tx.toFixed(2)}px`);
      el.style.setProperty("--ty", `${x.ty.toFixed(2)}px`);
      el.style.setProperty("--sc", x.sc.toFixed(4));
      el.style.setProperty("--rx", `${x.rx.toFixed(2)}deg`);
      el.style.setProperty("--ry", `${x.ry.toFixed(2)}deg`);
      el.style.setProperty("--gx", `${(50 - Math.sin((x.ry * Math.PI) / 180) * 70 - x.rx).toFixed(1)}%`);
    }, LIFT);
  }

  useLayoutEffect(() => {
    const b = body.current;
    b.paint(b.x);
    Object.assign(b.t, {
      tx: layout.cx - (rect.left + rect.width / 2),
      ty: layout.cy - (rect.top + rect.height / 2),
      sc: layout.sc, rx: 5, ry: FACE,
    });
    if (reduceMotion()) settle(b); else wake(b);
    primaryRef.current?.focus({ preventScroll: true });
    return () => stop(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const putBack = useCallback(() => {
    if (phase === "down") return;
    setPhase("down");
    const b = body.current;
    const now = slot.isConnected ? slot.getBoundingClientRect() : rect;
    b.held.clear();
    b.coast = null;
    b.x.ry = (((b.x.ry % 360) + 540) % 360) - 180; // home by the short way round
    Object.assign(b.t, { tx: now.left - rect.left, ty: now.top - rect.top, sc: 1, rx: 0, ry: 0 });
    b.onRest = () => { b.onRest = null; onClose(); };
    if (reduceMotion()) settle(b); else wake(b);
  }, [phase, slot, rect, onClose]);

  useEffect(() => {
    // Esc puts the case back (and nothing else: the app's own Esc would leave the page). Tab
    // stays on the case and its buttons: the page under the dim can't be reached.
    const key = event => {
      if (event.key === "Tab") {
        const items = [...(liftRef.current?.querySelectorAll("button") || [])];
        const at = items.indexOf(document.activeElement);
        const next = event.shiftKey ? items[at <= 0 ? items.length - 1 : at - 1] : items[(at + 1) % items.length];
        if (next) { event.preventDefault(); next.focus(); }
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      putBack();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", putBack);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("resize", putBack); };
  }, [putBack]);

  // Drag to spin; a throw keeps turning and lands on the front or the back.
  const drag = useRef(null);
  const down = event => {
    if (event.button || phase === "down") return;
    drag.current = { x: event.clientX, y: event.clientY, last: event.clientX, moved: false, rx: body.current.x.rx };
    caseRef.current?.setPointerCapture(event.pointerId);
    body.current.coast = null;
  };
  const move = event => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 5) return;
    d.moved = true;
    const b = body.current;
    b.held.add("ry"); b.held.add("rx");
    b.v.ry = (event.clientX - d.last) * 0.55;
    b.x.ry += b.v.ry;
    b.x.rx = Math.max(-28, Math.min(28, d.rx - (event.clientY - d.y) * 0.2));
    d.last = event.clientX;
    wake(b);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const b = body.current;
    if (d.moved) {
      b.held.clear();
      b.t.rx = 5;
      b.coast = { key: "ry", friction: 0.955, until: 0.5, land: at => Math.round((at - FACE) / 180) * 180 + FACE };
      wake(b);
    } else {
      // A click turns it over.
      b.t.ry = Math.round((b.x.ry - FACE) / 180) * 180 + FACE + 180;
      wake(b);
    }
  };

  const meta = [year(item.releaseInfo), lengthOf(item)].filter(Boolean).join(" · ");
  const infoStyle = layout.wide
    ? { left: layout.cx + (rect.width * layout.sc) / 2 + 56, top: layout.cy }
    : { left: 24, right: 24, top: layout.cy + (rect.height * layout.sc) / 2 + 40 };

  return createPortal(
    // data-modal-open: while a case is in hand the app's keys (Back, search, the mouse's back button) leave the page alone.
    <div ref={liftRef} className={`bd-lift${phase === "down" ? " is-down" : ""}`} role="dialog" aria-modal="true" aria-label={item.name} data-modal-open>
      <div className="bd-lift-dim" onClick={putBack} onWheel={putBack} />
      <div className="bd-lift-pool" style={{ left: layout.cx, top: layout.cy + (rect.height * layout.sc) / 2 + 14, width: rect.width * layout.sc * 1.9 }} />
      <div className="bd-stage" ref={stageRef} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, "--w": `${rect.width}px`, "--h": `${rect.height}px`, "--d": "13px" }}>
        <button
          className="bd-case is-full"
          ref={caseRef}
          aria-label="Turn the case over"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); body.current.t.ry += event.key === "ArrowLeft" ? -45 : 45; wake(body.current); } }}
          onClick={event => { if (event.detail === 0) up(); }}
        >
          <CaseFaces item={item} full />
        </button>
      </div>
      <div className={`bd-info${layout.wide ? "" : " is-under"}`} style={infoStyle}>
        <span className="bd-info-kick">Finished {finishedOn(item.completedAt || Date.now())}</span>
        <h2 className="bd-info-title" dir="auto">{item.name}</h2>
        {meta ? <span className="bd-info-meta num">{meta}</span> : null}
        <div className="bd-info-actions">
          <button className="btn btn-primary" ref={primaryRef} onClick={() => { onClose(); onPlay(item); }}><LuPlay /> Watch again</button>
          <button className="btn btn-glass" onClick={() => { onClose(); onDetails(item); }}><LuInfo /> Details</button>
          <button className="btn btn-glass btn-icon bd-info-remove" aria-label={`Remove ${item.name} from trophies`} title="Remove from trophies" onClick={() => { onClose(); onRemove(item); }}><LuTrash2 /></button>
        </div>
        <span className="bd-info-tip">Drag to spin · click to turn over · Esc to put back</span>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The trophy shelves: one per month, every finished film or series standing on it as a Blu-ray
 * case. Run the pointer along a shelf and the cases lean; pick one up to turn it in your hands.
 */
export default function Shelf({ shelves, label, onPlay, onDetails, onRemove }) {
  const [lift, setLift] = useState(null);
  const lastSlot = useRef(null);
  const close = useCallback(() => {
    setLift(null);
    lastSlot.current?.focus({ preventScroll: true });
  }, []);
  const away = lift ? `${lift.item.type}:${lift.item.id}` : null;
  return (
    <>
      {shelves.map(([key, list], i) => (
        <section className="bd-shelf" key={key} data-rise={i < 2 ? "" : undefined}>
          <h2 className="bd-shelf-title">{label(key)} <span className="num">{list.length}</span></h2>
          <ShelfRow
            items={list}
            away={away}
            onLift={(item, slot, lean) => {
              lastSlot.current = slot;
              setLift({ item, slot, rect: slot.getBoundingClientRect(), lean });
            }}
          />
        </section>
      ))}
      {lift ? <Lifted key={away} lift={lift} onClose={close} onPlay={onPlay} onDetails={onDetails} onRemove={onRemove} /> : null}
    </>
  );
}
