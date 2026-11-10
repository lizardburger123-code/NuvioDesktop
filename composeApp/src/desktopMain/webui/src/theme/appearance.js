// Turns the appearance settings (accent colour, backdrop picture, blur) into CSS variables.
// Everything visual that depends on the user's colours reads these variables, so a change
// repaints the whole app in one frame.

export const DEFAULT_APPEARANCE = {
  colors: ["#1d2b64", "#6b3fa0", "#e0607e"],
  wallpaper: { mode: "featured", image: null },
  dim: 0.35,
  blur: 0,
  animate: true,
  blurArt: false,
  profileGate: true,
};

/** Cinema accents: one colour each (stored three times, the shape the settings file already has). */
export const PRESETS = [
  { name: "Amber", colors: ["#f0b27a", "#f0b27a", "#f0b27a"] },
  { name: "Ivory", colors: ["#ece7de", "#ece7de", "#ece7de"] },
  { name: "Sky", colors: ["#8ec5ff", "#8ec5ff", "#8ec5ff"] },
  { name: "Mint", colors: ["#8fe3c0", "#8fe3c0", "#8fe3c0"] },
  { name: "Rose", colors: ["#ff9db5", "#ff9db5", "#ff9db5"] },
  { name: "Violet", colors: ["#b9a7ff", "#b9a7ff", "#b9a7ff"] },
];

// Gradient sets from the earlier look map onto the nearest Cinema accent, so nobody opens the
// new interface to a colour chosen for a design that no longer exists.
const LEGACY = {
  "#1d2b64,#6b3fa0,#e0607e": "#f0b27a",
  "#1a0f0a,#9a3412,#f59e0b": "#f0b27a",
  "#062a3a,#0e7490,#5eead4": "#8fe3c0",
  "#0b1f14,#166534,#a3e635": "#8fe3c0",
  "#2a0f1d,#be185d,#fda4af": "#ff9db5",
  "#0b0b0d,#3f3f46,#d4d4d8": "#ece7de",
};
export const accentOf = colors => LEGACY[(colors || []).join(",").toLowerCase()] || deriveAccent(colors || []);

const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));

export const parseHex = hex => {
  const clean = String(hex || "").trim().replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean.slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

export const toHex = ([r, g, b]) => `#${[r, g, b].map(c => clampByte(c).toString(16).padStart(2, "0")).join("")}`;

const luminance = ([r, g, b]) => {
  const channel = c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

const saturation = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
};

/**
 * The accent is the most saturated of the three colours, lifted until it reads on the dark
 * ground (4.5:1) so it can carry selected states, progress and focus rings.
 */
export const deriveAccent = colors => {
  const parsed = colors.map(parseHex).filter(Boolean);
  if (!parsed.length) return "#8b7cf6";
  let accent = [...parsed].sort((a, b) => saturation(b) * (0.4 + luminance(b)) - saturation(a) * (0.4 + luminance(a)))[0];
  const ground = [7, 7, 11];
  for (let i = 0; i < 12 && contrast(accent, ground) < 4.5; i += 1) accent = mix(accent, [255, 255, 255], 0.14);
  return toHex(accent);
};

export const inkOn = hex => {
  const rgb = parseHex(hex) || [255, 255, 255];
  return contrast(rgb, [255, 255, 255]) >= contrast(rgb, [10, 10, 12]) ? "#ffffff" : "#0a0a0c";
};

export const applyAppearance = appearance => {
  const value = { ...DEFAULT_APPEARANCE, ...(appearance || {}) };
  const colors = (value.colors || DEFAULT_APPEARANCE.colors).slice(0, 3);
  while (colors.length < 3) colors.push(colors[colors.length - 1] || "#6b3fa0");
  const root = document.documentElement.style;
  colors.forEach((color, i) => {
    root.setProperty(`--g${i + 1}`, color);
    const rgb = parseHex(color) || [100, 80, 160];
    root.setProperty(`--g${i + 1}-rgb`, rgb.join(" "));
  });
  const accent = accentOf(colors);
  root.setProperty("--accent", accent);
  root.setProperty("--accent-rgb", (parseHex(accent) || [139, 124, 246]).join(" "));
  root.setProperty("--on-accent", inkOn(accent));
  root.setProperty("--wall-dim", String(Math.max(0, Math.min(0.9, Number(value.dim) || 0))));
  root.setProperty("--wall-blur", `${Math.max(0, Math.min(40, Number(value.blur) || 0))}px`);
  document.documentElement.dataset.animate = value.animate === false ? "off" : "on";
  return { ...value, colors, accent };
};
