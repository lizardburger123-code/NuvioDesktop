// HTML subtitle layer for the desktop player.
//
// mpv decodes subtitles and pushes the current plain text (sub-text) here; this
// page draws it, so SRT, VTT and ASS tracks look and sit the same. Bitmap tracks
// (PGS, DVB, VobSub) cannot be re-drawn as text, so mpv keeps drawing those.
//
// Alignments: "center", "left", "right" (MBC 2: right-aligned, every line flush right).
// Positions x / y are percentages of the video picture and are clamped before every use.
(() => {
  "use strict";

  const ALIGN_CODES = { center: 0, left: 1, right: 2 };
  // MBC 2: the block sits centred (movable by dragging); its lines are right-aligned inside it,
  // so every line starts from the same right edge.
  const HOME = {
    right: { x: 50, y: 90 },
    left: { x: 7 },
    center: { x: 50 },
  };
  const X_RANGE = { right: [12, 88], left: [1, 25], center: [50, 50] };
  const Y_RANGE = [70, 96];
  const SNAP_PERCENT = 3;
  const CLICK_SLOP_PX = 6;
  const TWEEN_MS = 420;

  const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;
  const RTL_SCRIPT = /[֐-ࣿ]/;
  const ARABIC = /[؀-ۿ]/;
  const ARABIC_EDGE_PUNCTUATION = /[.…!?؟،,:;]$/;

  // "...لكن" instead of "لكن...": move leading punctuation of an Arabic line to its end.
  const OPENERS = { "(": ")", "[": "]", "{": "}", "«": "»" };
  // Files made for left-to-right players often store an opening bracket at the end of an Arabic
  // line: "محمد) كان يسرق من القمة.(" -> "(محمد) كان يسرق من القمة."
  const fixBrackets = line => {
    const match = line.match(/^([\s\S]*?)([.…!?؟،,:;]*)([(\[{«]+)([.…!?؟،,:;]*)$/);
    if (!match) return line;
    const [, body, before, openers, after] = match;
    const needs = [...openers].every(open => {
      const close = OPENERS[open];
      const opens = body.split(open).length - 1;
      const closes = body.split(close).length - 1;
      return closes > opens;
    });
    if (needs) return `${openers}${body}${before}${after}`.trim();
    // "محمد( كان يسرق من القمة(." : both brackets flipped for left-to-right players.
    // Move the trailing one to the front and turn the extra openers in the body into closers.
    let fixed = body;
    for (const open of openers) {
      const close = OPENERS[open];
      let extra = (fixed.split(open).length - 1) + 1 - (fixed.split(close).length - 1);
      while (extra >= 2) {
        const at = fixed.lastIndexOf(open);
        if (at < 0) break;
        fixed = fixed.slice(0, at) + close + fixed.slice(at + 1);
        extra -= 2;
      }
      if (extra !== 0) return line;
    }
    return `${openers}${fixed}${before}${after}`.trim();
  };

  // The other left-to-right hack: the closing bracket of a name at the end of the line is stored at
  // the start. ")والآن فكروا بشأن قتل السيدة (مارلو" -> "والآن فكروا بشأن قتل السيدة (مارلو)".
  // Also "(نص (اسم": two openers, the first one really closes the second.
  const PAIRS = [["(", ")"], ["[", "]"], ["{", "}"], ["«", "»"]];
  const fixLeadingBracket = line => {
    if (!ARABIC.test(line)) return line;
    const match = line.match(/^([.…!?؟،,:;]*)\s*([()\[\]{}«»])\s*([\s\S]*\S)$/);
    if (!match) return line;
    const [, punct, edge, rest] = match;
    const pair = PAIRS.find(p => p.includes(edge));
    const inner = [...rest].filter(c => pair.includes(c));
    if (inner.length !== 1) return line;
    // "(مارلو) والآن" is already right.
    if (edge === pair[0] && inner[0] === pair[1]) return line;
    const at = rest.indexOf(inner[0]);
    // Name first: "(اليس نيكولز( تعرضت للخنق" -> the inner bracket is glued to the word before it,
    // so it closes the name: "(اليس نيكولز) تعرضت للخنق".
    const gluedBefore = at > 0 && !/\s/.test(rest[at - 1]);
    const gluedAfter = at < rest.length - 1 && !/\s/.test(rest[at + 1]);
    if (gluedBefore && !gluedAfter) return `${pair[0]}${rest.slice(0, at)}${pair[1]}${rest.slice(at + 1)}${punct}`;
    const body = (rest.slice(0, at) + pair[0] + rest.slice(at + 1).replace(/^\s+/, "")).trimEnd();
    const tail = body.match(/[.…!?؟،,:;]*$/)[0];
    return `${body.slice(0, body.length - tail.length).trimEnd()}${pair[1]}${tail}${punct}`;
  };

  const arabicLine = raw => {
    const line = fixLeadingBracket(fixBrackets(raw.replace(BIDI_CONTROLS, "").trim()));
    if (!ARABIC.test(line)) return line;
    const match = line.match(/^([.…!?؟،,:;]+)\s*([\s\S]*\S)$/);
    return match && !ARABIC_EDGE_PUNCTUATION.test(match[2]) ? match[2] + match[1] : line;
  };

  // ---- One sentence per line (MBC style) -----------------------------------
  //
  // "ماذا تريد هل... لا لست هنا" becomes two lines, "ماذا تريد هل..." over "لا لست هنا".
  // Splits after sentence punctuation and before dialogue dashes. Latin text only splits when
  // the next sentence starts with a capital, so "I was... thinking" stays together.
  const ABBREVIATION = /(?:^|\s)(?:mr|mrs|ms|dr|st|jr|sr|vs|etc|lt|col|gen|prof|capt|sgt|mt|no)\.$/i;
  const INITIAL = /(?:^|\s)\p{Lu}\.$/u;
  const LATIN_LOWER = /^[a-z\u00df-\u00ff]/;
  const HAS_WORD = /[\p{L}\p{N}]{2,}|[\p{Script=Arabic}]/u;

  const splitSentences = line => {
    // Punctuation glued to the next Arabic word ("هل ...لا") belongs to the end of the previous sentence.
    const text = line.replace(/\s+([.!?؟…]+)(?=\p{Script=Arabic})/gu, "$1 ");
    const pieces = [];
    let start = 0;
    const breaks = /([.!?؟…]+)(\s+)(?=\S)|(\s+)(?=[-–—]\s*\S)/gu;
    let match;
    while ((match = breaks.exec(text))) {
      const isDash = match[3] !== undefined;
      const cut = isDash ? match.index : match.index + match[1].length;
      const resume = isDash ? match.index + match[3].length : cut + match[2].length;
      const head = text.slice(start, cut).trim();
      const rest = text.slice(resume);
      if (!head || !HAS_WORD.test(head)) continue;
      if (isDash) {
        // "- Hi - Bye": a dash mid-line only starts a new speaker after a finished sentence or when the line opened with one.
        if (!/^[-–—]/.test(text.trim()) && !/[.!?؟…]$/.test(head)) continue;
      } else {
        if (ABBREVIATION.test(head) || INITIAL.test(head)) continue;
        if (!/\p{Script=Arabic}/u.test(rest.slice(0, 3)) && LATIN_LOWER.test(rest)) continue;
      }
      pieces.push(head);
      start = resume;
    }
    pieces.push(text.slice(start).trim());
    // Never leave a fragment without a word on its own line.
    return pieces.reduce((out, piece) => {
      if (!piece) return out;
      if (out.length && !HAS_WORD.test(piece)) out[out.length - 1] += ` ${piece}`;
      else out.push(piece);
      return out;
    }, []);
  };

  // mpv hands over plain text, but some files still carry markup.
  const cleanText = text => text
    .replace(/\r\n?/g, "\n")
    .replace(/\\N/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:i|b|u|s|font)\b[^>]*>/gi, "")
    .replace(/\{\\[^}]*\}/g, "");

  const layer = document.createElement("div");
  layer.className = "sub-layer";
  layer.setAttribute("aria-live", "off");
  const box = document.createElement("div");
  box.className = "sub-box";
  box.dataset.empty = "true";
  layer.appendChild(box);
  const playerRoot = document.getElementById("playerRoot");
  playerRoot.insertBefore(layer, playerRoot.querySelector(".content"));

  let layout = { align: "center", x: NaN, y: NaN };
  let lastText = "";
  let overlayMode = null; // null until native reports support
  let nativeSupportsOverlay = false;
  let videoAspect = 0;
  let bitmapSubtitles = false;
  let renderedSignature = "";

  const finite = value => typeof value === "number" && Number.isFinite(value);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const homeY = align => {
    if (align === "right") return HOME.right.y;
    const style = (typeof state !== "undefined" && state.subtitleStyle) || {};
    const offset = Number(style.bottomOffset);
    // Same mapping as mpv's sub-pos (100 - bottomOffset / 2), kept inside the safe band.
    return clamp(finite(offset) ? 100 - offset / 2 : 90, Y_RANGE[0], Y_RANGE[1]);
  };
  const homeX = align => HOME[align] ? HOME[align].x : HOME.center.x;

  const clampLayout = next => {
    const align = ALIGN_CODES[next.align] === undefined ? "center" : next.align;
    let x = Number(next.x);
    let y = Number(next.y);
    const [xMin, xMax] = X_RANGE[align];
    // A position saved by an older layout (MBC used to sit at the far right) goes back home.
    x = finite(x) && x >= xMin && x <= xMax ? x : homeX(align);
    if (align === "center") x = HOME.center.x;
    if (!finite(y) || y < Y_RANGE[0] || y > Y_RANGE[1]) y = homeY(align);
    return { align, x, y };
  };

  // The rectangle the video picture occupies inside the window.
  const pictureRect = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const label = String((typeof state !== "undefined" && state.resizeModeLabel) || "Fit").toLowerCase();
    if (!(videoAspect > 0) || (label && label !== "fit")) {
      return { left: 0, top: 0, width, height };
    }
    let pictureWidth = width;
    let pictureHeight = width / videoAspect;
    if (pictureHeight > height) {
      pictureHeight = height;
      pictureWidth = height * videoAspect;
    }
    return {
      left: (width - pictureWidth) / 2,
      top: (height - pictureHeight) / 2,
      width: pictureWidth,
      height: pictureHeight,
    };
  };

  const placeLayer = () => {
    const rect = pictureRect();
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
  };

  const applyPosition = (animate = false) => {
    layout = clampLayout(layout);
    box.dataset.align = layout.align;
    if (animate) {
      box.classList.add("sub-tweening");
      window.clearTimeout(applyPosition.timer);
      applyPosition.timer = window.setTimeout(() => box.classList.remove("sub-tweening"), TWEEN_MS + 40);
    }
    box.style.left = `${layout.x}%`;
    box.style.top = `${layout.y}%`;
    const maxWidth = layout.align === "right"
      ? Math.min(layout.x, 100 - layout.x) * 2 - 4
      : layout.align === "left"
        ? 100 - layout.x - 2
        : 92;
    box.style.maxWidth = `${Math.max(10, maxWidth)}cqw`;
  };

  const applyStyle = () => {
    const custom = typeof state === "undefined" || state.customSubtitleStylingEnabled !== false;
    const style = (custom && typeof state !== "undefined" && state.subtitleStyle) || {};
    const color = typeof parseArgb === "function" && style.textColor ? parseArgb(style.textColor).css : "#fff";
    const outlineOn = custom ? style.outlineEnabled !== false : true;
    const outlineColor = typeof parseArgb === "function" && style.outlineColor
      ? parseArgb(style.outlineColor).css
      : "rgba(0,0,0,.92)";
    const sizeSp = finite(Number(style.fontSizeSp)) ? Number(style.fontSizeSp) : 18;
    // mpv draws subtitles at (sp * 3) units of a 720-line canvas: express that in cqh.
    box.style.setProperty("--sub-size", `${((sizeSp * 3) / 720) * 100}cqh`);
    box.style.setProperty("--sub-color", color);
    box.style.setProperty("--sub-outline", outlineOn ? outlineColor : "transparent");
    box.style.setProperty("--sub-weight", style.bold ? "700" : "600");
    box.style.setProperty("--sub-font", `"${String(currentFont()).replace(/["\\]/g, "")}"`);
  };

  const subtitleStyle = () => (typeof state !== "undefined" && state.subtitleStyle) || {};
  let localSplit = null; // optimistic value until the next controls update
  let localFont = null;
  const splitLinesEnabled = () => (localSplit !== null ? localSplit : subtitleStyle().splitLines !== false);
  const currentFont = () => localFont || subtitleStyle().font || "Cairo";

  const render = () => {
    const showText = overlayMode === true && !bitmapSubtitles && lastText.trim().length > 0;
    const signature = showText ? `${splitLinesEnabled() ? 1 : 0}|${lastText}` : "";
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    box.replaceChildren();
    box.dataset.empty = showText ? "false" : "true";
    if (!showText) return;
    const split = splitLinesEnabled();
    for (const raw of cleanText(lastText).split("\n")) {
      const sentences = split ? splitSentences(raw.replace(BIDI_CONTROLS, "")) : [raw];
      for (const sentence of sentences) {
        const isRtl = RTL_SCRIPT.test(sentence);
        const text = isRtl ? arabicLine(sentence) : sentence.replace(BIDI_CONTROLS, "");
        if (!text.trim()) continue;
        const line = document.createElement("div");
        line.className = isRtl ? "sub-line sub-line-rtl" : "sub-line";
        line.dir = isRtl ? "rtl" : "auto";
        line.textContent = text;
        box.appendChild(line);
      }
    }
  };

  const setOverlayMode = enabled => {
    if (overlayMode === enabled) return;
    overlayMode = enabled;
    if (typeof send === "function") send("subtitleOverlayMode", enabled ? 1 : 0);
    renderedSignature = "\u0001";
    render();
  };

  const syncOverlayMode = () => {
    if (!nativeSupportsOverlay) return;
    setOverlayMode(!bitmapSubtitles);
  };

  // ---- Native hooks ------------------------------------------------------

  window.playerSubtitleText = text => {
    lastText = typeof text === "string" ? text : "";
    render();
  };

  const wrap = (name, after) => {
    const original = window[name];
    if (typeof original !== "function") return;
    window[name] = payload => {
      const result = original(payload);
      try { after(payload || {}); } catch (error) { console.error("subtitle layer", error); }
      return result;
    };
  };

  wrap("playerUpdate", update => {
    if (typeof update.subtitleBitmap === "boolean") {
      nativeSupportsOverlay = true;
      bitmapSubtitles = update.subtitleBitmap;
    }
    const aspect = Number(update.videoAspect);
    if (finite(aspect) && aspect > 0 && Math.abs(aspect - videoAspect) > 0.0005) {
      videoAspect = aspect;
      placeLayer();
    }
    syncOverlayMode();
    render();
  });

  let lastNoticeId = null;
  wrap("playerControls", () => {
    const style = (typeof state !== "undefined" && state.subtitleStyle) || {};
    const noticeId = Number(style.autoSyncNoticeId) || 0;
    if (lastNoticeId === null) {
      lastNoticeId = noticeId;
    } else if (noticeId !== lastNoticeId) {
      lastNoticeId = noticeId;
      if (style.autoSyncNotice && typeof showPlayerToast === "function") {
        showPlayerToast(style.autoSyncNotice, { icon: "icon-subs", durationMs: 3200 });
      }
    }
    if (!dragging) {
      const incoming = clampLayout({ align: style.align, x: style.x, y: style.y });
      const alignChanged = incoming.align !== layout.align;
      layout = incoming;
      applyPosition(alignChanged);
    }
    localSplit = null;
    localFont = null;
    applyStyle();
    renderAlignmentControls();
    renderFontControls();
    placeLayer();
    renderedSignature = "\u0001";
    render();
  });

  window.addEventListener("resize", () => {
    placeLayer();
    applyPosition(false);
  });

  // ---- Drag, click, double-click ----------------------------------------

  let pointerStart = null;
  let dragging = false;
  let clickTimer = 0;

  const goHome = () => {
    layout = clampLayout({ align: layout.align });
    applyPosition(true);
    if (typeof send === "function") send("subtitleResetPosition", 0);
  };

  box.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const rect = layer.getBoundingClientRect();
    pointerStart = {
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: layout.x,
      y: layout.y,
      width: rect.width || 1,
      height: rect.height || 1,
    };
    dragging = false;
    try { box.setPointerCapture(event.pointerId); } catch (_) {}
  });

  box.addEventListener("pointermove", event => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    const dx = event.clientX - pointerStart.clientX;
    const dy = event.clientY - pointerStart.clientY;
    if (!dragging && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    if (!dragging) {
      dragging = true;
      box.classList.add("sub-dragging");
    }
    let x = pointerStart.x + (dx / pointerStart.width) * 100;
    let y = pointerStart.y + (dy / pointerStart.height) * 100;
    const homeXValue = homeX(layout.align);
    const homeYValue = homeY(layout.align);
    if (Math.abs(x - homeXValue) <= SNAP_PERCENT) x = homeXValue;
    if (Math.abs(y - homeYValue) <= SNAP_PERCENT) y = homeYValue;
    const [xMin, xMax] = X_RANGE[layout.align];
    layout = {
      align: layout.align,
      x: clamp(x, xMin, xMax),
      y: clamp(y, Y_RANGE[0], Y_RANGE[1]),
    };
    applyPosition(false);
  });

  const endPointer = event => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    event.stopPropagation();
    try { box.releasePointerCapture(event.pointerId); } catch (_) {}
    const wasDragging = dragging;
    pointerStart = null;
    dragging = false;
    box.classList.remove("sub-dragging");
    if (wasDragging) {
      if (typeof send === "function") {
        send("subtitlePosX", layout.x);
        send("subtitlePosY", layout.y);
      }
      return;
    }
    if (event.type !== "pointerup") return;
    // A movement under 6 px is a click: toggle pause (unless a double-click follows).
    window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      if (typeof requestPlaybackState === "function") {
        requestPlaybackState("setPlaybackStateQuiet", false);
      }
    }, 230);
  };
  box.addEventListener("pointerup", endPointer);
  box.addEventListener("pointercancel", endPointer);
  box.addEventListener("click", event => event.stopPropagation());
  box.addEventListener("dblclick", event => {
    event.stopPropagation();
    event.preventDefault();
    window.clearTimeout(clickTimer);
    goHome();
  });

  // ---- Style panel controls --------------------------------------------

  const styleCard = document.querySelector("#subtitleStylePanel .style-card");
  const bottomOffsetSection = document.getElementById("bottomOffsetLabel")?.closest(".style-section");
  const section = document.createElement("div");
  section.className = "style-section sub-align-section";
  section.innerHTML = `
    <span class="style-label">Subtitle Alignment</span>
    <div class="sub-align-segmented" role="radiogroup" aria-label="Subtitle alignment">
      <button type="button" class="sub-align-option" data-align="center" role="radio">Center</button>
      <button type="button" class="sub-align-option" data-align="left" role="radio">Left</button>
      <button type="button" class="sub-align-option" data-align="right" role="radio">MBC 2 (right-aligned)</button>
    </div>
    <button class="panel-button sub-align-reset" type="button">Reset position</button>
  `;
  if (styleCard) {
    styleCard.insertBefore(section, bottomOffsetSection ? bottomOffsetSection.nextSibling : styleCard.firstChild);
  }

  const fontSection = document.createElement("div");
  fontSection.className = "style-section sub-font-section";
  fontSection.innerHTML = `
    <span class="style-label">Font</span>
    <div class="sub-font-grid" role="radiogroup" aria-label="Subtitle font"></div>
    <div class="sub-split-row">
      <span class="style-label">One sentence per line</span>
      <button class="panel-button sub-split-toggle" type="button" aria-pressed="true">On</button>
    </div>
  `;
  if (styleCard) styleCard.insertBefore(fontSection, section.nextSibling);
  const fontGrid = fontSection.querySelector(".sub-font-grid");
  const splitToggle = fontSection.querySelector(".sub-split-toggle");
  let fontSignature = "";

  const renderFontControls = () => {
    const fonts = Array.isArray(subtitleStyle().fonts) ? subtitleStyle().fonts : [];
    const signature = fonts.join("|");
    if (signature !== fontSignature) {
      fontSignature = signature;
      fontGrid.replaceChildren();
      fonts.forEach((name, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sub-font-option";
        button.dataset.font = name;
        button.dataset.index = String(index);
        button.setAttribute("role", "radio");
        const sample = document.createElement("span");
        sample.className = "sub-font-sample";
        sample.dir = "rtl";
        sample.style.fontFamily = `"${name}", sans-serif`;
        sample.textContent = "ماذا تريد؟";
        const label = document.createElement("span");
        label.className = "sub-font-name";
        label.textContent = name;
        button.append(sample, label);
        fontGrid.appendChild(button);
      });
    }
    const active = currentFont();
    fontGrid.querySelectorAll(".sub-font-option").forEach(button => {
      const on = button.dataset.font === active;
      button.classList.toggle("active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
    });
    const split = splitLinesEnabled();
    splitToggle.textContent = split ? "On" : "Off";
    splitToggle.setAttribute("aria-pressed", split ? "true" : "false");
    splitToggle.classList.toggle("active", split);
  };

  fontSection.addEventListener("click", event => {
    event.stopPropagation();
    const option = event.target.closest(".sub-font-option");
    if (option) {
      localFont = option.dataset.font;
      applyStyle();
      renderFontControls();
      if (typeof send === "function") send("subtitleFont", Number(option.dataset.index));
      return;
    }
    if (event.target.closest(".sub-split-toggle")) {
      localSplit = !splitLinesEnabled();
      renderFontControls();
      renderedSignature = "\u0001";
      render();
      if (typeof send === "function") send("subtitleSplitLines", localSplit ? 1 : 0);
    }
  });

  const renderAlignmentControls = () => {
    section.querySelectorAll(".sub-align-option").forEach(button => {
      const active = button.dataset.align === layout.align;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", active ? "true" : "false");
    });
  };

  section.addEventListener("click", event => {
    event.stopPropagation();
    const option = event.target.closest(".sub-align-option");
    if (option) {
      const align = option.dataset.align;
      if (align === layout.align) {
        goHome();
        return;
      }
      layout = clampLayout({ align });
      applyPosition(true);
      renderAlignmentControls();
      if (typeof send === "function") send("subtitleAlign", ALIGN_CODES[align]);
      return;
    }
    if (event.target.closest(".sub-align-reset")) goHome();
  });

  placeLayer();
  applyStyle();
  applyPosition(false);
  renderAlignmentControls();
  renderFontControls();
})();
