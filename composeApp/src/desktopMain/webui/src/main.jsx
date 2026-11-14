import { createRoot } from "react-dom/client";
import "./theme/base.css";
import "./app.css";
import "./theme/haze.css";
import App from "./App.jsx";
import { notify } from "./bridge.js";
import { applyLook, rememberedLook } from "./lib/look.js";
import { applyPerf, forcedPerf, rememberedPerf } from "./lib/perf.js";

// The intro plays before the settings arrive: wear the look the last launch used, and its
// performance mode (Lite has no intro at all).
applyLook(rememberedLook());
applyPerf(forcedPerf() || rememberedPerf());

window.addEventListener("error", event => notify("app.log", { level: "error", message: String(event.message), source: `${event.filename}:${event.lineno}` }));
window.addEventListener("unhandledrejection", event => notify("app.log", { level: "error", message: String(event.reason?.message || event.reason) }));

createRoot(document.getElementById("root")).render(<App />);
