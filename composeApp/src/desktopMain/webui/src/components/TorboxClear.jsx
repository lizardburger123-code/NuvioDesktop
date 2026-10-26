import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuCloudDownload, LuCopy, LuExternalLink, LuLoaderCircle, LuTrash2, LuX } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { EASE, reduceMotion } from "../lib/motion.js";
import "./TorboxClear.css";

const size = bytes => (bytes >= 1e12 ? `${(bytes / 1e12).toFixed(1)} TB` : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

/**
 * Empty the TorBox cloud: connect TorBox if this app has no key yet (device code, nothing to
 * type here), show what's there, confirm, delete.
 */
export default function TorboxClear({ onClose, onCleared, mode = "clear", onConnected }) {
  const connectOnly = mode === "connect";
  const { toast } = useApp();
  const [step, setStep] = useState("checking"); // checking | connect | confirm | clearing | done
  const [summary, setSummary] = useState(null);
  const [device, setDevice] = useState(null);
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef(null);
  const closing = useRef(false);

  const check = () => {
    setStep("checking");
    call("torbox.summary", {}, { timeoutMs: 30000 }).then(s => {
      setSummary(s);
      if (s?.connected && connectOnly) { onConnected?.(); close(); return; }
      setStep(s?.connected ? "confirm" : "connect");
    }, error => { toast(error.message, { tone: "error" }); setStep("connect"); });
  };
  useEffect(check, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Device sign-in: show the code, wait for TorBox to confirm.
  useEffect(() => {
    if (step !== "connect") return undefined;
    let alive = true;
    let timer = 0;
    call("torbox.connect.start").then(start => {
      if (!alive) return;
      setDevice(start);
      const poll = () => {
        timer = window.setTimeout(async () => {
          try {
            const r = await call("torbox.connect.poll", { deviceCode: start.deviceCode });
            if (!alive) return;
            if (r.status === "connected") { toast("TorBox connected"); check(); return; }
            if (r.status === "expired") { setDevice(null); toast("That code expired. Here's a new one.", { tone: "error" }); setAttempt(n => n + 1); return; }
          } catch { /* keep polling */ }
          if (alive) poll();
        }, Math.max(3, start.interval || 5) * 1000);
      };
      poll();
    }, error => toast(error.message, { tone: "error" }));
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, attempt]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (!ref.current || reduceMotion()) { onClose(); return; }
    ref.current.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.97)" }], { duration: 150, easing: EASE.exit, fill: "forwards" }).onfinish = onClose;
  };

  useLayoutEffect(() => {
    if (!ref.current || reduceMotion()) return;
    ref.current.animate([{ opacity: 0, transform: "translate3d(0, 12px, 0) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: EASE.out });
  }, []);

  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && step !== "clearing") { event.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const clear = async () => {
    setStep("clearing");
    try {
      const r = await call("torbox.clear", {}, { timeoutMs: 600000 });
      setResult(r);
      setStep("done");
      onCleared?.();
    } catch (error) {
      toast(error.message, { tone: "error" });
      setStep("confirm");
    }
  };

  return createPortal(
    <div className="tbx-layer" data-modal-open onClick={() => step !== "clearing" && close()}>
      <div ref={ref} className="tbx glass-dark" role="dialog" aria-label={connectOnly ? "Connect TorBox" : "Clear TorBox library"} onClick={event => event.stopPropagation()}>
        <header className="tbx-head">
          <span className={`tbx-icon${connectOnly ? " is-calm" : ""}`}>{connectOnly ? <LuCloudDownload /> : <LuTrash2 />}</span>
          <h2>{connectOnly ? "Connect TorBox" : "Clear your TorBox library"}</h2>
          <button className="btn btn-glass btn-icon btn-sm" onClick={close} disabled={step === "clearing"} aria-label="Close"><LuX /></button>
        </header>

        {step === "checking" ? <p className="tbx-text"><LuLoaderCircle className="spin" /> Looking at your TorBox…</p> : null}

        {step === "connect" ? (
          <div className="tbx-body">
            <p className="tbx-text">{connectOnly ? "To cache sources on TorBox, Nuvio signs in to TorBox once." : "Nuvio needs to sign in to TorBox once to manage your files."} Open the link, sign in, and enter this code:</p>
            <div className="tbx-code">
              {device ? <strong className="num">{device.code}</strong> : <LuLoaderCircle className="spin" />}
              {device ? <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(device.code).then(() => toast("Code copied"), () => {})}><LuCopy /> Copy</button> : null}
            </div>
            <div className="tbx-actions">
              <button className="btn btn-primary" disabled={!device} onClick={() => call("app.openUrl", { url: device.url })}><LuExternalLink /> Open TorBox</button>
            </div>
            <p className="tbx-note">This waits here and continues by itself once TorBox confirms.</p>
          </div>
        ) : null}

        {step === "confirm" && summary ? (
          <div className="tbx-body">
            {summary.count ? (
              <>
                <p className="tbx-text">
                  This deletes <strong>{summary.count} {summary.count === 1 ? "item" : "items"}</strong>
                  {summary.size ? <> ({size(summary.size)})</> : null} from your TorBox cloud: every torrent, Usenet and web download.
                  They aren't lost for good; playing a title again adds it back from cache.
                </p>
                <div className="tbx-actions">
                  <button className="btn btn-ghost" onClick={close}>Keep them</button>
                  <button className="btn tbx-danger" onClick={clear}><LuTrash2 /> Delete {summary.count}</button>
                </div>
              </>
            ) : (
              <>
                <p className="tbx-text">Your TorBox cloud is already empty.</p>
                <div className="tbx-actions"><button className="btn btn-primary" onClick={close}>Done</button></div>
              </>
            )}
          </div>
        ) : null}

        {step === "clearing" ? <p className="tbx-text"><LuLoaderCircle className="spin" /> Deleting… this takes a moment for a big library.</p> : null}

        {step === "done" && result ? (
          <div className="tbx-body">
            <p className="tbx-text">
              Deleted {result.removed} {result.removed === 1 ? "item" : "items"}.
              {result.failed ? ` ${result.failed} couldn't be deleted; try again in a minute.` : " Your TorBox library is clean."}
            </p>
            <div className="tbx-actions"><button className="btn btn-primary" onClick={close}>Done</button></div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
