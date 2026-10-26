// Hiding a catalog row from Home (and the section screens). Settings › Appearance lists them all.
import { call } from "../bridge.js";

export const hideRow = (section, toast) =>
  call("home.rows.set", { key: section.key, enabled: false }).then(
    () => toast(`${section.title} hidden. Settings › Appearance › Rows brings it back.`),
    error => toast(error.message, { tone: "error" }),
  );
