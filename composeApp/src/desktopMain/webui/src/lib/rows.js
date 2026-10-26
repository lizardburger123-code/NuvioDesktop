// Hiding a catalog row from Home (and the section screens). Settings › Appearance lists them all.
import { call } from "../bridge.js";

export const hideRow = (section, toast) =>
  call("home.rows.set", { key: section.key, enabled: false }).then(
    () => toast(`${section.title} hidden`, {
      action: {
        label: "Undo",
        run: () => call("home.rows.set", { key: section.key, enabled: true }).catch(error => toast(error.message, { tone: "error" })),
      },
    }),
    error => toast(error.message, { tone: "error" }),
  );
