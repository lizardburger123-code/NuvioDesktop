import { createRoot } from "react-dom/client";
import "./theme/base.css";
import "./app.css";
import "./theme/haze.css";
import App from "./App.jsx";
import LITE_CSS from "./theme/lite.css?text";
import { notify } from "./bridge.js";
import { applyLook, rememberedLook } from "./lib/look.js";
import { applyPerf, forcedPerf, onPerfChange, perfMode, rememberedPerf } from "./lib/perf.js";

// The intro plays before the settings arrive: wear the look the last launch used, and its
// performance mode (Lite has no intro at all).
applyLook(rememberedLook());
applyPerf(forcedPerf() || rememberedPerf());

// Lite's flat versions of everything (theme/lite.css) are a sheet of their own, last in the page so
// they win over every look and component, and switched off outside Lite: Full doesn't even try
// its selectors, several of which would otherwise be checked against every element.
const liteSheet = document.createElement("style");
liteSheet.textContent = LITE_CSS;
const followPerf = mode => { liteSheet.media = mode === "lite" ? "all" : "not all"; };
followPerf(perfMode());
document.head.append(liteSheet);
onPerfChange(followPerf);

window.addEventListener("error", event => notify("app.log", { level: "error", message: String(event.message), source: `${event.filename}:${event.lineno}` }));
window.addEventListener("unhandledrejection", event => notify("app.log", { level: "error", message: String(event.reason?.message || event.reason) }));

createRoot(document.getElementById("root")).render(<App />);
