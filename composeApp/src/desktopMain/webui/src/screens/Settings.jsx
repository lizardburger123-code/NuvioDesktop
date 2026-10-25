import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuCaptions, LuExternalLink, LuImage, LuKeyRound, LuLoaderCircle, LuPalette, LuPlay, LuPuzzle,
  LuTrash2, LuUser, LuInfo, LuCheck, LuRefreshCw, LuMonitorPlay,
} from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { PRESETS, applyAppearance, parseHex } from "../theme/appearance.js";
import { navigate } from "../lib/router.js";
import { initials } from "../components/TopBar.jsx";
import "./Settings.css";

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: LuPalette },
  { id: "subtitles", label: "Subtitles", icon: LuCaptions },
  { id: "playback", label: "Playback", icon: LuPlay },
  { id: "addons", label: "Addons", icon: LuPuzzle },
  { id: "profile", label: "Profile", icon: LuUser },
  { id: "about", label: "About", icon: LuInfo },
];

export default function Settings({ params }) {
  const section = params.section || "appearance";
  const current = SECTIONS.find(s => s.id === section) || SECTIONS[0];
  return (
    <main className="screen settings">
      <aside className="settings-nav glass-flat" aria-label="Settings sections">
        <h1 className="settings-h">Settings</h1>
        {SECTIONS.map(s => {
          const Icon = s.icon;
          return (
            <button key={s.id} className="settings-nav-item" aria-current={s.id === current.id ? "page" : undefined} onClick={() => navigate("settings", { section: s.id }, { replace: true })}>
              <Icon /> {s.label}
            </button>
          );
        })}
      </aside>
      <section className="settings-body" key={current.id}>
        <h2 className="t-page">{current.label}</h2>
        {current.id === "appearance" ? <Appearance /> : null}
        {current.id === "subtitles" ? <Subtitles /> : null}
        {current.id === "playback" ? <Playback /> : null}
        {current.id === "addons" ? <Addons /> : null}
        {current.id === "profile" ? <Profile /> : null}
        {current.id === "about" ? <About /> : null}
      </section>
    </main>
  );
}

function Panel({ title, description, children, aside }) {
  return (
    <section className="panel">
      <div className="panel-label">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
        {aside}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label }) {
  return <button className="switch" role="switch" aria-checked={Boolean(checked)} aria-label={label} onClick={() => onChange(!checked)} />;
}

function Saved({ show }) {
  return <span className={`saved-stamp${show ? " on" : ""}`} aria-live="polite">{show ? <><LuCheck /> Saved</> : null}</span>;
}

const useSavedStamp = () => {
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  return [on, () => { setOn(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOn(false), 1600); }];
};

/* ---------------------------------------------------------------- Appearance */

function ColourField({ index, value, onChange }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="colour-field">
      <label className="colour-swatch" style={{ background: value }} title={`Colour ${index + 1}`}>
        <input type="color" value={value} onChange={event => onChange(event.target.value)} aria-label={`Colour ${index + 1}`} />
      </label>
      <input
        className="field colour-hex num"
        value={text}
        onChange={event => {
          setText(event.target.value);
          if (parseHex(event.target.value)) onChange(event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`);
        }}
        aria-label={`Colour ${index + 1} hex`}
        spellCheck={false}
      />
    </div>
  );
}

const resizeImage = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Couldn't read that file."));
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error("That file isn't an image Nuvio can open."));
    img.onload = () => {
      const scale = Math.min(1, 2560 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

function Appearance() {
  const { appearance, setAppearance, toast } = useApp();
  const colors = appearance.colors || PRESETS[0].colors;
  const [saved, stamp] = useSavedStamp();
  const fileRef = useRef(null);

  const update = patch => {
    const next = { ...appearance, ...patch };
    applyAppearance(next);
    setAppearance(patch);
    stamp();
  };
  const setColour = (i, hex) => {
    const next = [...colors];
    next[i] = hex;
    update({ colors: next });
  };

  const onFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const image = await resizeImage(file);
      update({ wallpaper: { mode: "custom", image } });
    } catch (error) {
      toast(error.message, { tone: "error" });
    }
  };

  const mode = appearance.wallpaper?.mode || "featured";
  return (
    <>
      <Panel title="Gradient colours" description="Three colours drive the background, the tiles and every highlight. The highlight colour is picked from them and lightened until it stays readable." aside={<Saved show={saved} />}>
        <div className="colour-row">
          {colors.map((c, i) => <ColourField key={i} index={i} value={c} onChange={hex => setColour(i, hex)} />)}
        </div>
        <div className="preview-gradient" style={{ background: `linear-gradient(120deg, ${colors[0]}, ${colors[1]} 55%, ${colors[2]})` }}>
          <div className="preview-tile" style={{ background: `linear-gradient(140deg, ${colors[1]}, ${colors[2]})` }}><span>Watch later</span><strong className="num">12</strong></div>
          <div className="preview-tile" style={{ background: `linear-gradient(150deg, ${colors[0]}, ${colors[1]} 120%)` }}><span>New episode</span><strong className="num">9:00</strong></div>
          <div className="preview-chip" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>Highlight</div>
        </div>
        <div className="preset-row">
          <span className="t-meta">Start from</span>
          {PRESETS.map(preset => (
            <button key={preset.name} className="preset" onClick={() => update({ colors: preset.colors })} title={preset.name}>
              <span style={{ background: `linear-gradient(120deg, ${preset.colors.join(", ")})` }} />
              {preset.name}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Wallpaper" description="The picture behind Home and Search, tinted with your colours. Featured artwork rotates through the titles on Home; a title's page always shows that title's artwork.">
        <div className="seg glass-flat" role="group" aria-label="Wallpaper">
          {[["featured", "Featured artwork"], ["custom", "My image"], ["none", "Gradient only"]].map(([id, label]) => (
            <button key={id} aria-pressed={mode === id} onClick={() => (id === "custom" && !appearance.wallpaper?.image ? fileRef.current?.click() : update({ wallpaper: { ...appearance.wallpaper, mode: id } }))}>{label}</button>
          ))}
        </div>
        <div className="wall-row">
          <div className="wall-thumb" style={appearance.wallpaper?.image ? { backgroundImage: `url("${appearance.wallpaper.image}")` } : undefined}>
            {!appearance.wallpaper?.image ? <LuImage /> : null}
          </div>
          <div className="wall-actions">
            <button className="btn btn-glass btn-sm" onClick={() => fileRef.current?.click()}><LuImage /> Choose image…</button>
            {appearance.wallpaper?.image ? (
              <button className="btn btn-ghost btn-sm" onClick={() => update({ wallpaper: { mode: mode === "custom" ? "featured" : mode, image: null } })}><LuTrash2 /> Remove</button>
            ) : null}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
          </div>
        </div>
        <label className="slider-row">
          <span>Dim</span>
          <input className="range" type="range" min="0" max="0.8" step="0.05" value={appearance.dim ?? 0.35} onChange={event => update({ dim: Number(event.target.value) })} />
          <span className="num slider-value">{Math.round((appearance.dim ?? 0.35) * 100)}%</span>
        </label>
        <label className="slider-row">
          <span>Blur</span>
          <input className="range" type="range" min="0" max="40" step="1" value={appearance.blur ?? 0} onChange={event => update({ blur: Number(event.target.value) })} />
          <span className="num slider-value">{appearance.blur ?? 0}px</span>
        </label>
      </Panel>

      <Panel title="Motion" description="The background gradient drifts slowly. Turn it off to keep the GPU free for 4K playback on slower machines.">
        <div className="toggle-row">
          <span>Animated background</span>
          <Toggle checked={appearance.animate !== false} onChange={value => update({ animate: value })} label="Animated background" />
        </div>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- Subtitles */

export const SUBTITLE_FONTS = [
  { id: "Cairo", note: "Modern, clear" },
  { id: "Tajawal", note: "Light, geometric" },
  { id: "Almarai", note: "Rounded, bold" },
  { id: "IBM Plex Sans Arabic", note: "Neutral" },
  { id: "Noto Kufi Arabic", note: "Kufi" },
  { id: "Noto Naskh Arabic", note: "Classic Naskh" },
  { id: "Readex Pro", note: "Wide" },
  { id: "Changa", note: "Condensed" },
  { id: "Amiri", note: "Book Naskh" },
  { id: "Segoe UI", note: "Windows default" },
  { id: "Tahoma", note: "Windows" },
  { id: "Arial", note: "MBC-like" },
  { id: "Sakkal Majalla", note: "Windows" },
  { id: "Traditional Arabic", note: "Windows" },
];

export const SAMPLE_LINES = ["ماذا تريد هل...", "لا، لست هنا"];

const PROVIDERS = [
  { id: "opensubtitles", name: "OpenSubtitles", url: "https://www.opensubtitles.com/en/consumers", fields: [["apiKey", "API key", true], ["username", "Username (optional)", false], ["password", "Password (optional)", true]], note: "Biggest catalogue. A free account raises the daily download limit." },
  { id: "subdl", name: "SubDL", url: "https://subdl.com/panel/api", fields: [["apiKey", "API key", true]], note: "Strong Arabic coverage." },
  { id: "subsource", name: "SubSource", url: "https://subsource.net/api-docs", fields: [["apiKey", "API key", true]], note: "Home of most former Subscene Arabic uploads." },
];

function SubtitlePreview({ style }) {
  const align = style.align || "right";
  return (
    <div className="sub-preview" aria-label="Subtitle preview">
      <div className={`sub-preview-box align-${align}`}
        style={{
          fontFamily: `"${style.font}", "IBM Plex Sans Arabic", sans-serif`,
          fontSize: `${((style.size || 18) * 3 / 720) * 100}cqh`,
          fontWeight: style.bold ? 700 : 500,
          color: style.color || "#fff",
          WebkitTextStroke: style.outline ? `0.11em ${style.outlineColor || "#000"}` : "0",
        }}>
        {(style.splitLines !== false ? SAMPLE_LINES : [SAMPLE_LINES.join(" ")]).map(line => (
          <div key={line} dir="rtl" className="sub-preview-line">{line}</div>
        ))}
      </div>
    </div>
  );
}

function Subtitles() {
  const { toast } = useApp();
  const [value, setValue] = useState(null);
  const [saved, stamp] = useSavedStamp();
  const [testing, setTesting] = useState(null);

  useEffect(() => { call("settings.subtitles.get").then(setValue, error => toast(error.message, { tone: "error" })); }, [toast]);

  const update = patch => {
    setValue(prev => ({ ...prev, ...patch }));
    call("settings.subtitles.set", patch).then(stamp, error => toast(error.message, { tone: "error" }));
  };

  if (!value) return <div className="panel skel" style={{ height: 320 }} />;
  const providers = value.providers || {};

  const test = async id => {
    setTesting(id);
    try {
      const result = await call("subtitles.testProvider", { provider: id }, { timeoutMs: 20000 });
      toast(result?.ok ? `${PROVIDERS.find(p => p.id === id).name} is working` : (result?.message || "That key didn't work"), { tone: result?.ok ? undefined : "error" });
    } catch (error) {
      toast(error.message, { tone: "error" });
    } finally {
      setTesting(null);
    }
  };

  return (
    <>
      <Panel title="Look" description="Applies to text subtitles (SRT, VTT, ASS). Picture-based tracks (PGS) keep their own look." aside={<Saved show={saved} />}>
        <SubtitlePreview style={value} />
        <div className="font-grid" role="radiogroup" aria-label="Font">
          {SUBTITLE_FONTS.map(font => (
            <button key={font.id} role="radio" aria-checked={value.font === font.id} className="font-card" onClick={() => update({ font: font.id })}>
              <span className="font-sample" dir="rtl" style={{ fontFamily: `"${font.id}", sans-serif` }}>ماذا تريد؟</span>
              <span className="font-name">{font.id}</span>
              <span className="font-note">{font.note}</span>
            </button>
          ))}
        </div>
        <label className="slider-row">
          <span>Size</span>
          <input className="range" type="range" min="10" max="36" step="1" value={value.size || 18} onChange={event => update({ size: Number(event.target.value) })} />
          <span className="num slider-value">{value.size || 18}</span>
        </label>
        <div className="toggle-row"><span>Bold</span><Toggle checked={value.bold} onChange={bold => update({ bold })} label="Bold" /></div>
        <div className="toggle-row"><span>Outline</span><Toggle checked={value.outline !== false} onChange={outline => update({ outline })} label="Outline" /></div>
        <div className="toggle-row">
          <span>Text colour</span>
          <span className="colour-inline">
            {["#FFFFFF", "#FFF3B0", "#FFE066", "#B8F2E6"].map(c => (
              <button key={c} className="dot" style={{ background: c }} aria-pressed={(value.color || "#FFFFFF").toUpperCase() === c} aria-label={c} onClick={() => update({ color: c })} />
            ))}
          </span>
        </div>
      </Panel>

      <Panel title="Placement" description="MBC 2 keeps every line flush right near the bottom right of the picture. Each line of the subtitle stays on its own line.">
        <div className="seg glass-flat" role="group" aria-label="Alignment">
          {[["right", "MBC 2 (right-aligned)"], ["center", "Center"], ["left", "Left"]].map(([id, label]) => (
            <button key={id} aria-pressed={(value.align || "right") === id} onClick={() => update({ align: id })}>{label}</button>
          ))}
        </div>
        <div className="toggle-row">
          <span>
            Split sentences onto their own lines
            <small>When a line holds two sentences or two speakers (“...”, “؟”, “ - ”), show them as separate lines, the way MBC does.</small>
          </span>
          <Toggle checked={value.splitLines !== false} onChange={splitLines => update({ splitLines })} label="Split sentences" />
        </div>
        <div className="toggle-row">
          <span>
            Sync automatically
            <small>Lines addon subtitles up with the video's own subtitle timing when a subtitle starts.</small>
          </span>
          <Toggle checked={value.autoSync !== false} onChange={autoSync => update({ autoSync })} label="Sync automatically" />
        </div>
      </Panel>

      <Panel title="Search sources" description="Manual search in the player (Subtitles › Search) looks through these sites. Each needs your own free API key; keys stay on this PC.">
        <div className="providers">
          {PROVIDERS.map(provider => (
            <div key={provider.id} className="provider">
              <div className="provider-head">
                <strong>{provider.name}</strong>
                <span className="t-meta">{provider.note}</span>
                <span className="provider-tools">
                  <button className="btn btn-ghost btn-sm" onClick={() => call("app.openUrl", { url: provider.url })}><LuExternalLink /> Get a key</button>
                  <button className="btn btn-glass btn-sm" onClick={() => test(provider.id)} disabled={testing != null}>
                    {testing === provider.id ? <LuLoaderCircle className="spin" /> : <LuRefreshCw />} Check
                  </button>
                </span>
              </div>
              <div className="provider-fields">
                {provider.fields.map(([field, label, secret]) => (
                  <label key={field} className="provider-field">
                    <span>{label}</span>
                    <input
                      className="field"
                      type={secret ? "password" : "text"}
                      defaultValue={providers[provider.id]?.[field] || ""}
                      onBlur={event => {
                        const next = { ...providers, [provider.id]: { ...(providers[provider.id] || {}), [field]: event.target.value.trim() } };
                        update({ providers: next });
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={field === "apiKey" ? "Paste your key" : ""}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="toggle-row">
          <span>Preferred languages<small>Searched first, in this order.</small></span>
          <span className="lang-list">
            {[["ar", "Arabic"], ["en", "English"], ["fr", "French"], ["tr", "Turkish"]].map(([code, label]) => {
              const on = (value.languages || []).includes(code);
              return (
                <button key={code} className="chip" aria-pressed={on} onClick={() => update({ languages: on ? value.languages.filter(l => l !== code) : [...(value.languages || []), code] })}>{label}</button>
              );
            })}
          </span>
        </div>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- Playback */

function Playback() {
  const { toast } = useApp();
  const [items, setItems] = useState(null);
  const [saved, stamp] = useSavedStamp();
  useEffect(() => { call("settings.playback.get").then(setItems, error => { setItems([]); toast(error.message, { tone: "error" }); }); }, [toast]);
  const set = (key, value) => {
    setItems(list => list.map(item => (item.key === key ? { ...item, value } : item)));
    call("settings.playback.set", { key, value }).then(stamp, error => toast(error.message, { tone: "error" }));
  };
  if (!items) return <div className="panel skel" style={{ height: 240 }} />;
  return (
    <Panel title="Player" description="How sources are picked and how playback starts." aside={<Saved show={saved} />}>
      {items.map(item => (
        <div key={item.key} className="toggle-row">
          <span>{item.label}{item.description ? <small>{item.description}</small> : null}</span>
          {item.type === "toggle" ? <Toggle checked={item.value} onChange={value => set(item.key, value)} label={item.label} /> : null}
          {item.type === "select" ? (
            <select className="field select-inline" value={item.value} onChange={event => set(item.key, event.target.value)}>
              {item.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : null}
        </div>
      ))}
      <button className="btn btn-glass btn-sm settings-classic" onClick={() => call("legacy.open", { page: "playback" })}><LuMonitorPlay /> All player settings</button>
    </Panel>
  );
}

/* ---------------------------------------------------------------- Addons */

function Addons() {
  const { toast } = useApp();
  const [addons, setAddons] = useState(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => call("addons.list").then(setAddons, error => toast(error.message, { tone: "error" }));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const install = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await call("addons.install", { url: url.trim() }, { timeoutMs: 30000 });
      toast("Addon installed");
      setUrl("");
      load();
    } catch (error) {
      toast(error.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async addon => {
    if (!window.confirm(`Remove ${addon.name}? Its catalogs and sources disappear until you install it again.`)) return;
    try {
      await call("addons.remove", { id: addon.id });
      toast(`${addon.name} removed`);
      load();
    } catch (error) {
      toast(error.message, { tone: "error" });
    }
  };

  return (
    <>
      <Panel title="Install" description="Paste a manifest link (ends in manifest.json), for example from AIOStreams or an addon's configure page.">
        <form className="install-row" onSubmit={event => { event.preventDefault(); install(); }}>
          <input className="field" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…/manifest.json" spellCheck={false} />
          <button className="btn btn-primary" disabled={busy || !url.trim()}>{busy ? <LuLoaderCircle className="spin" /> : null} Install</button>
        </form>
      </Panel>
      <Panel title="Installed" description="Order matters: higher addons answer first for catalogs and sources.">
        {!addons ? <div className="skel" style={{ height: 160 }} /> : null}
        <ul className="addon-list">
          {(addons || []).map(addon => (
            <li key={addon.id} className="addon">
              <span className="addon-logo">{addon.logo ? <img src={addon.logo} alt="" /> : initials(addon.name)}</span>
              <span className="addon-text">
                <strong>{addon.name}</strong>
                <span className="t-meta">{[addon.description, addon.version ? `v${addon.version}` : null].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="addon-tools">
                {addon.configurable ? <button className="btn btn-ghost btn-sm" onClick={() => call("addons.configure", { id: addon.id })}><LuExternalLink /> Configure</button> : null}
                <button className="btn btn-ghost btn-sm" onClick={() => remove(addon)} aria-label={`Remove ${addon.name}`}><LuTrash2 /></button>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- Profile & About */

function Profile() {
  const { boot, toast } = useApp();
  return (
    <>
      <Panel title="Who's watching" description="Each profile keeps its own progress, Watch later and settings.">
        <div className="profiles">
          {(boot.profiles || []).map(profile => (
            <button key={profile.id} className="profile-card" aria-pressed={profile.id === boot.profile?.id} onClick={() => profile.id !== boot.profile?.id && call("profiles.switch", { id: profile.id }).then(() => window.location.reload(), error => toast(error.message, { tone: "error" }))}>
              {profile.avatar
                ? <img className="avatar avatar-lg avatar-img" src={profile.avatar} alt="" />
                : <span className="avatar avatar-lg" style={profile.color ? { background: profile.color } : undefined}>{initials(profile.name)}</span>}
              <span>{profile.name}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Classic interface" description="Every older settings page (integrations, collections, layout, accounts) is still there.">
        <div className="classic-row">
          <button className="btn btn-glass btn-sm" onClick={() => call("legacy.open", { page: "settings" })}><LuKeyRound /> Open classic settings</button>
          <button className="btn btn-ghost btn-sm" onClick={() => call("app.useClassic", { enabled: true })}>Switch back to the classic interface</button>
        </div>
      </Panel>
    </>
  );
}

function About() {
  const { boot } = useApp();
  const credits = useMemo(() => [
    ["Interface", "React, GSAP 3.15, React Bits (Grainient, GlassSurface, TiltedCard, SpotlightCard, ShinyText) by David Haz"],
    ["Fonts", "Plus Jakarta Sans, IBM Plex Sans Arabic, Cairo, Tajawal, Almarai, Noto Naskh / Kufi Arabic, Readex Pro, Changa, Amiri (SIL Open Font License)"],
    ["Icons", "Lucide"],
  ], []);
  return (
    <Panel title="Nuvio" description={`Version ${boot.version || ""}`}>
      <dl className="credits">
        {credits.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </Panel>
  );
}
