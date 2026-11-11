import { createRoot } from "react-dom/client";
import "./theme/base.css";
import "./app.css";
import "./theme/haze.css";
import App from "./App.jsx";
import { notify } from "./bridge.js";
import { applyLook, rememberedLook } from "./lib/look.js";

// The intro plays before the settings arrive: wear the look the last launch used.
applyLook(rememberedLook());

window.addEventListener("error", event => notify("app.log", { level: "error", message: String(event.message), source: `${event.filename}:${event.lineno}` }));
window.addEventListener("unhandledrejection", event => notify("app.log", { level: "error", message: String(event.reason?.message || event.reason) }));

createRoot(document.getElementById("root")).render(<App />);
