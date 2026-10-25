// "Search online" in the subtitle panel: OpenSubtitles, SubDL, SubSource and Podnapisi.
// The search runs in Kotlin (SubtitleSearchService); its state arrives as state.subtitleStyle.search.
(() => {
  "use strict";

  const MODES = [
    { mode: 1, label: "Arabic" },
    { mode: 2, label: "English" },
    { mode: 0, label: "My languages" },
  ];
  const LANGUAGE_NAMES = { ar: "Arabic", en: "English", fr: "French", tr: "Turkish", es: "Spanish", de: "German", fa: "Persian", ur: "Urdu" };

  let lastAutoRun = -1;
  let savedScroll = 0;
  let scrollHooked = null;

  const searchState = () => {
    const style = (typeof state !== "undefined" && state.subtitleStyle) || {};
    return style.search || { status: "idle", results: [] };
  };

  const formatCount = value => {
    const n = Number(value) || 0;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M downloads`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k downloads`;
    return n > 0 ? `${n} downloads` : "";
  };

  const run = mode => {
    if (typeof send === "function") send("subtitleSearchRun", mode);
  };

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  window.renderSubtitleSearch = container => {
    const search = searchState();
    const results = Array.isArray(search.results) ? search.results : [];

    if (scrollHooked !== container) {
      scrollHooked = container;
      container.addEventListener("scroll", () => { savedScroll = container.scrollTop; }, { passive: true });
    }

    // First visit for this video: search the preferred languages straight away.
    if (search.status === "idle" && lastAutoRun !== Number(search.revision)) {
      lastAutoRun = Number(search.revision);
      run(0);
    }

    const head = element("div", "subsearch-head");
    const modes = element("div", "subsearch-modes");
    modes.setAttribute("role", "radiogroup");
    modes.setAttribute("aria-label", "Search languages");
    MODES.forEach(({ mode, label }) => {
      const button = element("button", "subsearch-mode", label);
      button.type = "button";
      const active = Number(search.mode) === mode && search.status !== "idle";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", active ? "true" : "false");
      button.classList.toggle("active", active);
      button.addEventListener("click", event => {
        event.stopPropagation();
        run(mode);
      });
      modes.appendChild(button);
    });
    head.appendChild(modes);
    container.appendChild(head);

    const status = element("div", "subsearch-status");
    if (search.status === "loading") {
      status.textContent = "Searching OpenSubtitles, SubDL, SubSource and Podnapisi…";
      status.classList.add("busy");
    } else if (search.message) {
      status.textContent = search.message;
      status.classList.toggle("error", search.status === "error");
    } else if (search.status === "done") {
      status.textContent = `${results.length} result${results.length === 1 ? "" : "s"}, closest to this file first`;
    }
    if (status.textContent) container.appendChild(status);

    if (search.status === "loading") {
      for (let i = 0; i < 5; i += 1) container.appendChild(element("div", "subsearch-skeleton"));
    }

    results.forEach((item, index) => {
      const loading = Number(search.loadingIndex) === index;
      const loaded = Number(search.loadedIndex) === index;
      const row = element("button", `track-row subtitle-option-row subsearch-row${loaded ? " selected" : ""}${loading ? " loading" : ""}`);
      row.type = "button";
      row.disabled = loading;
      row.addEventListener("click", event => {
        event.stopPropagation();
        if (typeof send === "function") send("subtitleSearchPick", index);
      });
      const copy = element("span", "subtitle-option-copy");
      copy.appendChild(element("span", "subtitle-source-chip", item.provider || ""));
      const title = element("span", "subtitle-option-title", item.release || "Unnamed release");
      title.dir = "auto";
      copy.appendChild(title);
      const meta = [LANGUAGE_NAMES[item.language] || String(item.language || "").toUpperCase(), formatCount(item.downloads), item.hi ? "Hearing impaired" : ""]
        .filter(Boolean)
        .join(" · ");
      copy.appendChild(element("span", "subtitle-option-metadata", loading ? "Downloading…" : meta));
      row.appendChild(copy);
      if (typeof buildCheckIcon === "function") row.appendChild(buildCheckIcon());
      container.appendChild(row);
    });

    window.requestAnimationFrame(() => { container.scrollTop = savedScroll; });
  };
})();
