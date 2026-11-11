// What this page knows about its own reloads.
//
// The page is loaded once per launch. A second load in the same launch is either one the app asked
// for (switching profile: start over, intro and all) or the web view replacing a page whose process
// crashed. The second kind should cost the user nothing: no intro, and the section they were in.
const read = key => { try { return window.sessionStorage.getItem(key); } catch { return null; } };
const write = (key, value) => {
  try {
    if (value == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch { /* storage is a nicety here */ }
};

const SESSION = "nuvio.session";
const INTENDED = "nuvio.reload";
const SECTION = "nuvio.section";

const loadedBefore = read(SESSION) === "1";
const intended = read(INTENDED) === "1";
write(INTENDED, null);
write(SESSION, "1");

/** This load replaces a page that was lost under the user. */
export const recovered = loadedBefore && !intended;

/** Reload on purpose (profile switch, "Try again"): a fresh start. */
export const reloadApp = () => {
  write(INTENDED, "1");
  write(SECTION, null);
  window.location.reload();
};

export const rememberSection = entry => write(SECTION, JSON.stringify({ name: entry.name, params: entry.params || {} }));

/** The section to come back to after a lost page, if any. */
export const savedSection = () => {
  if (!recovered) return null;
  try {
    const entry = JSON.parse(read(SECTION) || "null");
    return entry && typeof entry.name === "string" ? entry : null;
  } catch { return null; }
};

/** The page is painted on the CPU (Linux, some graphics drivers): nothing that needs the compositor. */
export const softwareRender = () => window.__nuvioRender === "software";
