// "From the disc" in the subtitle panel: the official Blu-ray subtitles (PGS), found inside another
// source of this title and copied onto the film that's playing. The work runs in Kotlin
// (NativePlayerController); its state arrives as state.subtitleStyle.disc.
(() => {
  "use strict";

  let lastAutoRun = "";

  const discState = () => {
    const style = (typeof state !== "undefined" && state.subtitleStyle) || {};
    return style.disc || { status: "idle", items: [] };
  };

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const run = () => { if (typeof send === "function") send("discSubsSearch", 0); };

  window.renderDiscSubtitles = container => {
    const disc = discState();
    const language = disc.languageName || "Arabic";
    const items = Array.isArray(disc.items) ? disc.items : [];

    // First visit for this video: look straight away.
    if (disc.status === "idle" && lastAutoRun !== String(disc.videoKey)) {
      lastAutoRun = String(disc.videoKey);
      run();
    }

    const intro = element("div", "disc-intro");
    intro.appendChild(element("strong", "", `Official ${language} subtitles`));
    intro.appendChild(element("span", "", "The translation from the Blu-ray, taken from another copy of this film and timed to the one you're watching."));
    container.appendChild(intro);

    const status = element("div", "subsearch-status");
    if (disc.status === "searching") {
      status.classList.add("busy");
      status.textContent = Number(disc.toCheck) > 0
        ? `Looking inside your sources… ${disc.checked} of ${disc.toCheck}`
        : "Gathering this title's sources…";
    } else if (disc.message) {
      status.textContent = disc.message;
      status.classList.toggle("error", disc.status === "error");
    }
    if (status.textContent) container.appendChild(status);

    if (disc.status === "searching") {
      for (let i = 0; i < 3; i += 1) container.appendChild(element("div", "subsearch-skeleton"));
    }

    items.forEach(item => {
      const index = Number(item.index);
      const applying = disc.status === "applying" && Number(disc.applying) === index;
      const applied = Number(disc.applied) === index;
      const row = element("button", `track-row subtitle-option-row is-disc disc-row${applied ? " selected" : ""}${applying ? " loading" : ""}`);
      row.type = "button";
      row.disabled = disc.status === "applying";
      row.addEventListener("click", event => {
        event.stopPropagation();
        if (typeof send === "function") send("discSubsApply", index);
      });
      const copy = element("span", "subtitle-option-copy");
      copy.appendChild(element("span", "subtitle-source-chip", "Blu-ray disc"));
      const track = String(item.track || "").trim();
      const title = element("span", "subtitle-option-title", `${language}${track && track.toLowerCase() !== language.toLowerCase() ? ` · ${track}` : ""}`);
      title.dir = "auto";
      copy.appendChild(title);
      if (applying) {
        const total = Number(disc.total) || 0;
        const done = Number(disc.done) || 0;
        copy.appendChild(element("span", "subtitle-option-metadata", total ? `Copying… ${done.toLocaleString()} of ${total.toLocaleString()}` : "Opening the file…"));
        const bar = element("span", "disc-progress");
        const fill = element("i");
        fill.style.width = `${total ? Math.round((done / total) * 100) : 4}%`;
        bar.appendChild(fill);
        copy.appendChild(bar);
      } else {
        const from = element("span", "subtitle-option-metadata", `From ${item.title}`);
        from.title = item.title;
        copy.appendChild(from);
        if (item.detail) copy.appendChild(element("span", "subtitle-option-metadata", item.detail));
      }
      row.appendChild(copy);
      if (typeof buildCheckIcon === "function") row.appendChild(buildCheckIcon());
      container.appendChild(row);
    });

    if (disc.status !== "searching" && disc.status !== "applying") {
      const again = element("button", "subsearch-mode disc-again", items.length ? "Look again" : "Search again");
      again.type = "button";
      again.addEventListener("click", event => { event.stopPropagation(); run(); });
      container.appendChild(again);
    }
  };
})();
