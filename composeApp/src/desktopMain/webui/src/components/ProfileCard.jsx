import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuArrowLeft, LuCamera, LuCheck, LuFlame, LuImage, LuLink, LuLock, LuPalette, LuSettings, LuUpload } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { BEFORE_NAV, goSection } from "../lib/router.js";
import { EASE, reduceMotion } from "../lib/motion.js";
import { holdAmbient } from "../lib/hold.js";
import "./ProfileCard.css";

export const initials = name => String(name || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();

export function Avatar({ profile, size = 32, className = "" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [profile?.avatar]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (profile?.avatar && !failed) {
    return <img className={`avatar avatar-img ${className}`} style={style} src={profile.avatar} alt="" onError={() => setFailed(true)} />;
  }
  return (
    <span className={`avatar ${className}`} style={{ ...style, ...(profile?.color ? { background: profile.color } : null) }}>
      {initials(profile?.name)}
    </span>
  );
}

/** Compact duration for the stat tiles: 42m, 6.5h, 12h. */
const short = minutes => (minutes < 60 ? `${minutes}m` : minutes < 600 ? `${(minutes / 60).toFixed(1).replace(/\.0$/, "")}h` : `${Math.round(minutes / 60)}h`);
const hours = minutes => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim() : `${minutes}m`);

/** Square-crop and shrink a picture from this PC to a 256px JPEG data URL. */
const toAvatarDataUrl = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    URL.revokeObjectURL(url);
    resolve(canvas.toDataURL("image/jpeg", 0.9));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a picture Nuvio can read.")); };
  img.src = url;
});

// Contents of a view rise in one after another (each on its own element).
const stagger = (root, selector = "[data-stagger]", from = "translate3d(0, 8px, 0)") => {
  if (!root || reduceMotion()) return;
  root.querySelectorAll(selector).forEach((node, i) => node.animate(
    [{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }],
    { duration: 380, delay: 40 + i * 35, easing: EASE.out, fill: "backwards" },
  ));
};

function WeekChart({ days = [] }) {
  const ref = useRef(null);
  const max = Math.max(30, ...days.map(day => day.minutes));
  useLayoutEffect(() => {
    if (!ref.current || reduceMotion()) return;
    ref.current.querySelectorAll(".pc-bar-fill").forEach((bar, i) => bar.animate(
      [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }],
      { duration: 700, delay: 180 + i * 45, easing: EASE.out, fill: "backwards" },
    ));
  }, [days]);
  return (
    <div ref={ref} className="pc-week" role="img" aria-label={`Watched this week: ${days.map(d => `${d.label} ${hours(d.minutes)}`).join(", ")}`}>
      {days.map((day, i) => (
        <div key={i} className={`pc-bar${day.today ? " is-today" : ""}`} title={`${day.label} · ${day.minutes ? hours(day.minutes) : "nothing"}`}>
          <div className="pc-bar-track">
            <span className="pc-bar-fill" style={{ height: `${Math.max(day.minutes ? 8 : 3, (day.minutes / max) * 100)}%` }} />
          </div>
          <span className="pc-bar-label">{day.label}</span>
        </div>
      ))}
    </div>
  );
}

function PictureView({ profile, onPicked, onBack }) {
  const { toast } = useApp();
  const [catalog, setCatalog] = useState(null);
  const [busy, setBusy] = useState(null);
  const [link, setLink] = useState("");
  const fileRef = useRef(null);
  const rootRef = useRef(null);

  useEffect(() => {
    call("profile.avatars").then(list => setCatalog(Array.isArray(list) ? list : []), () => setCatalog([]));
  }, []);
  useLayoutEffect(() => stagger(rootRef.current, "[data-stagger]", "translate3d(16px, 0, 0)"), []);
  useLayoutEffect(() => {
    if (!catalog?.length || !rootRef.current || reduceMotion()) return;
    rootRef.current.querySelectorAll(".pc-pick").forEach((node, i) => node.animate(
      [{ opacity: 0, transform: "scale(.7)" }, { opacity: 1, transform: "none" }],
      { duration: 420, delay: i * 18, easing: EASE.out, fill: "backwards" },
    ));
  }, [catalog]);

  const apply = async (params, key) => {
    setBusy(key);
    try {
      const result = await call("profile.setAvatar", params, { timeoutMs: 20000 });
      onPicked(result);
      toast(params.upload ? "Profile picture updated on this PC" : "Profile picture updated");
    } catch (error) {
      toast(error.message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const onFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      apply({ upload: await toAvatarDataUrl(file) }, "upload");
    } catch (error) {
      toast(error.message, { tone: "error" });
    }
  };

  return (
    <div ref={rootRef} className="pc-view">
      <header className="pc-sub-head" data-stagger>
        <button className="btn btn-glass btn-icon btn-sm" onClick={onBack} aria-label="Back to profile"><LuArrowLeft /></button>
        <h3>Profile picture</h3>
      </header>

      <div className="pc-grid" data-stagger role="listbox" aria-label="Nuvio pictures">
        {catalog === null ? Array.from({ length: 12 }, (_, i) => <span key={i} className="pc-pick skel" />) : null}
        {catalog?.map(item => (
          <button
            key={item.id}
            className="pc-pick"
            role="option"
            aria-selected={profile.avatar === item.url}
            title={item.name}
            disabled={Boolean(busy)}
            onClick={() => apply({ avatarId: item.id }, item.id)}
            style={item.color ? { background: item.color } : undefined}
          >
            <img src={item.url} alt={item.name} loading="lazy" />
            {busy === item.id ? <span className="pc-pick-busy" /> : null}
            {profile.avatar === item.url ? <span className="pc-pick-on"><LuCheck /></span> : null}
          </button>
        ))}
        {catalog && !catalog.length ? <p className="pc-note">Nuvio's pictures couldn't load. You can still use your own.</p> : null}
      </div>

      <div className="pc-own" data-stagger>
        <button className="btn btn-glass btn-sm" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
          {busy === "upload" ? <span className="pc-spin" /> : <LuUpload />} From this PC
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <form
          className="pc-link"
          onSubmit={event => { event.preventDefault(); if (link.trim()) apply({ url: link.trim() }, "link"); }}
        >
          <LuLink aria-hidden="true" />
          <input className="pc-link-input" value={link} onChange={event => setLink(event.target.value)} placeholder="https:// image link" aria-label="Image link" />
          <button className="btn btn-primary btn-sm" disabled={!link.trim() || Boolean(busy)}>Use</button>
        </form>
      </div>
      <p className="pc-note" data-stagger>
        <LuImage aria-hidden="true" /> Nuvio pictures and links follow your profile to every device. A picture from this PC stays on this PC.
      </p>
    </div>
  );
}

/**
 * The profile button's card: who's watching, what this week looked like, a quick way to change
 * the picture or switch profile. Grows out of the profile pill.
 */
export default function ProfileCard({ anchorRef, onClose, closeRequest = 0, initialView = "main" }) {
  const { boot, profile, setProfile, appearance } = useApp();
  const [view, setView] = useState(initialView);
  const [place, setPlace] = useState(null);
  const returning = useRef(false);
  const [stats, setStats] = useState(null);
  const [pop, setPop] = useState(0);
  const cardRef = useRef(null);
  const mainRef = useRef(null);
  const closing = useRef(false);

  useEffect(() => { call("profile.stats").then(setStats, () => setStats(null)); }, []);
  useEffect(() => holdAmbient(), []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (!cardRef.current || reduceMotion()) { onClose(); return; }
    const exit = cardRef.current.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(0, -6px, 0) scale(.96)" }],
      { duration: 170, easing: EASE.exit, fill: "forwards" },
    );
    exit.onfinish = onClose;
  };

  // Hang under the profile pill, growing out of the avatar.
  useLayoutEffect(() => {
    const seat = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPlace({ top: Math.round(rect.bottom + 10), right: Math.max(12, Math.round(window.innerWidth - rect.right)), origin: Math.round(rect.height / 2) });
    };
    seat();
    window.addEventListener("resize", seat);
    return () => window.removeEventListener("resize", seat);
  }, [anchorRef]);

  useEffect(() => { if (closeRequest) close(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [closeRequest]);
  useEffect(() => {
    const onNav = () => close();
    window.addEventListener(BEFORE_NAV, onNav);
    return () => window.removeEventListener(BEFORE_NAV, onNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!cardRef.current || reduceMotion()) return;
    cardRef.current.animate(
      [{ opacity: 0, transform: "translate3d(0, -10px, 0) scale(.92)" }, { opacity: 1, transform: "none" }],
      { duration: 460, easing: EASE.out },
    );
  }, []);
  useLayoutEffect(() => {
    if (view !== "main") return;
    stagger(mainRef.current, "[data-stagger]", returning.current ? "translate3d(-16px, 0, 0)" : "translate3d(0, 8px, 0)");
    returning.current = false;
  }, [view]);
  const showMain = () => { returning.current = true; setView("main"); };

  // A fresh picture lands with a ring pulse.
  useLayoutEffect(() => {
    if (!pop || !mainRef.current || reduceMotion()) return;
    mainRef.current.querySelector(".pc-avatar")?.animate(
      [{ transform: "scale(.8)", filter: "brightness(1.6)" }, { transform: "scale(1.08)", offset: 0.55 }, { transform: "none", filter: "none" }],
      { duration: 700, easing: EASE.out },
    );
  }, [pop]);

  useEffect(() => {
    const onDown = event => {
      if (cardRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
      close();
    };
    const onKey = event => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (view === "picture") showMain();
      else close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const others = (boot.profiles || []).filter(p => p.id !== profile?.id);
  const index = (boot.profiles || []).findIndex(p => p.id === profile?.id);
  const go = (name, params) => { close(); goSection(name, params); };
  const switchTo = target => {
    if (target.pin) return;
    call("profiles.switch", { id: target.id }).then(() => window.location.reload(), () => {});
  };

  const onPicked = result => {
    setProfile(prev => ({ ...prev, avatar: result?.avatar || prev.avatar, color: result?.color || prev.color }));
    showMain();
    setPop(n => n + 1);
  };

  const animate = appearance?.animate !== false;

  return createPortal(
    <div
      ref={cardRef}
      className="profile-pop glass-dark"
      data-modal-open
      role="dialog"
      aria-label="Profile"
      style={place ? { top: place.top, right: place.right, transformOrigin: `calc(100% - ${place.origin}px) -10px` } : { visibility: "hidden" }}
    >
      <div className={`pc-aurora${animate ? " is-live" : ""}`} aria-hidden="true">
        <span className="pc-blob pc-blob-1" />
        <span className="pc-blob pc-blob-2" />
        <span className="pc-blob pc-blob-3" />
      </div>

      {view === "main" ? (
        <div ref={mainRef} className="pc-view">
          <div className="pc-id" data-stagger>
            <button className="pc-avatar" onClick={() => setView("picture")} aria-label="Change profile picture" title="Change picture">
              <Avatar profile={profile} size={84} />
              <span className="pc-avatar-edit"><LuCamera /></span>
            </button>
            <div className="pc-who">
              <h3 dir="auto">{profile?.name || "You"}</h3>
              <span className="pc-meta">
                {boot.profiles?.length > 1 ? `Profile ${index + 1} of ${boot.profiles.length}` : "Your profile"}
                {stats?.streak >= 2 ? <span className="pc-streak"><LuFlame /> {stats.streak}-day streak</span> : null}
              </span>
            </div>
          </div>

          <div className="pc-stats" data-stagger>
            <div><strong className="num">{stats ? stats.inProgress : "–"}</strong><span>In progress</span></div>
            <div><strong className="num">{stats ? stats.finishedThisMonth : "–"}</strong><span>Finished this month</span></div>
            <div title="Estimated from your saved progress"><strong className="num">{stats ? short(stats.weekMinutes) : "–"}</strong><span>Watched this week</span></div>
          </div>

          <div data-stagger>
            {stats?.days?.length ? <WeekChart days={stats.days} /> : <div className="pc-week pc-week-empty skel" />}
          </div>

          {others.length ? (
            <div className="pc-switch" data-stagger>
              <span className="pc-label">Switch profile</span>
              <div className="pc-switch-row">
                {others.map(other => (
                  <button key={other.id} className="pc-other" onClick={() => switchTo(other)} disabled={other.pin} title={other.pin ? "Has a PIN: switch from the classic profile picker" : `Switch to ${other.name}`}>
                    <Avatar profile={other} size={40} />
                    <span dir="auto">{other.name}</span>
                    {other.pin ? <LuLock className="pc-lock" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="pc-actions" data-stagger>
            <button className="btn btn-glass btn-sm" onClick={() => setView("picture")}><LuCamera /> Change picture</button>
            <button className="btn btn-glass btn-sm" onClick={() => go("settings", { section: "appearance" })}><LuPalette /> Appearance</button>
            <button className="btn btn-glass btn-icon btn-sm" onClick={() => go("settings", { section: "profile" })} aria-label="Settings" title="Settings"><LuSettings /></button>
          </div>
        </div>
      ) : (
        <PictureView profile={profile} onPicked={onPicked} onBack={showMain} />
      )}
    </div>,
    document.body,
  );
}
