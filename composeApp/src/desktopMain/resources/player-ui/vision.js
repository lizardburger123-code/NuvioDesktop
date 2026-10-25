/*
 * Nuvio fork: motion and small behaviours for the "vision" player skin.
 *
 * - Elastic sliders (seek + volume): thicken on hover, stretch like rubber when dragged past an
 *   end. The spring and rubber-band maths are ported from React Bits' ElasticSlider
 *   (reactbits.dev, MIT + Commons Clause, David Haz), adapted to drive the existing native
 *   <input type=range> controls instead of replacing them.
 * - Loading text shimmer ported from React Bits' ShinyText (same licence).
 * - GSAP (vendor/gsap.min.js) for chrome reveal, panel entrance, the play/pause glyph swap and
 *   the toast. Everything collapses to instant changes under prefers-reduced-motion.
 *
 * controls.js stays the source of truth; this file only observes it and decorates.
 */
(() => {
  "use strict";

  const root = document.getElementById("playerRoot");
  if (!root) return;

  const hasGsap = typeof window.gsap === "object" && window.gsap;
  const gsap = hasGsap ? window.gsap : null;
  const reduceQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => Boolean(reduceQuery && reduceQuery.matches);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const TAU = Math.PI * 2;
  // ElasticSlider's rubber band: approaches `limit` as the overshoot grows.
  const rubber = (distance, limit) => (limit > 0 ? 2 * (1 / (1 + Math.exp(-distance / limit)) - 0.5) * limit : 0);

  const formatTime = totalSeconds => {
    const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    const pad = n => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  // ---- Time labels flanking the scrubber -----------------------------------------------------

  const seek = document.getElementById("seek");
  const scrubWrap = document.getElementById("scrubWrap");
  const bubble = document.getElementById("scrubBubble");
  const elapsedLabel = document.getElementById("timeElapsed");
  const remainingLabel = document.getElementById("timeRemaining");
  let durationSec = 0;
  let positionSec = 0;
  let scrubbing = false;

  const seekFraction = () => {
    if (!seek) return 0;
    const max = Number(seek.max) || 1;
    return clamp((Number(seek.value) || 0) / max, 0, 1);
  };

  const renderTimes = () => {
    const shown = scrubbing ? seekFraction() * durationSec : positionSec;
    if (elapsedLabel) elapsedLabel.textContent = formatTime(shown);
    if (remainingLabel) remainingLabel.textContent = durationSec > 0 ? `-${formatTime(durationSec - shown)}` : "--:--";
  };

  const originalUpdate = window.playerUpdate;
  if (typeof originalUpdate === "function") {
    window.playerUpdate = update => {
      const result = originalUpdate(update);
      try {
        durationSec = Math.max(0, Number(update && update.duration) || 0);
        positionSec = Math.max(0, Number(update && update.position) || 0);
        renderTimes();
      } catch (error) {
        console.error("vision times", error);
      }
      return result;
    };
  }

  // ---- Elastic slider driver -----------------------------------------------------------------

  const elastic = (input, options) => {
    if (!input) return null;
    const cssVar = options.cssVar;
    const originVar = options.originVar;
    const m = { a: 0, va: 0, goal: 0, s: 0, vs: 0, side: 1, held: false, raf: 0, last: 0 };
    let hovered = false;
    let dragging = false;
    let focused = false;

    const paint = () => {
      const thick = options.thickness + (options.activeThickness - options.thickness) * m.a;
      input.style.setProperty(cssVar, `${thick.toFixed(2)}px`);
      const length = Math.max(1, input.clientWidth);
      const along = 1 + m.s / length;
      const across = 1 - 0.22 * clamp(m.s / Math.max(1, options.maxStretch), -1, 1);
      input.style.setProperty(originVar, m.side > 0 ? "0% 50%" : "100% 50%");
      input.style.transform = Math.abs(m.s) < 0.05 ? "" : `scale(${along.toFixed(4)}, ${across.toFixed(4)})`;
      if (options.onPaint) options.onPaint(m.a);
    };

    const frame = now => {
      m.raf = 0;
      const elapsed = clamp((now - m.last) / 1000, 0, 1 / 20);
      m.last = now;
      if (reduced()) {
        m.a = m.goal;
        m.va = 0;
        if (!m.held) { m.s = 0; m.vs = 0; }
      } else {
        const steps = Math.max(1, Math.ceil(elapsed / (1 / 240)));
        const dt = elapsed / steps;
        const stretchOmega = TAU / 0.42;
        const stretchZeta = 1 - 0.9 * options.bounce;
        const activeOmega = TAU / 0.32;
        for (let i = 0; i < steps; i += 1) {
          if (!m.held) {
            m.vs += (-stretchOmega * stretchOmega * m.s - 2 * stretchZeta * stretchOmega * m.vs) * dt;
            m.s += m.vs * dt;
          }
          m.va += (-activeOmega * activeOmega * (m.a - m.goal) - 2 * 0.9 * activeOmega * m.va) * dt;
          m.a += m.va * dt;
        }
      }
      const settled = (m.held || (Math.abs(m.s) < 0.05 && Math.abs(m.vs) < 0.5)) &&
        Math.abs(m.a - m.goal) < 0.002 && Math.abs(m.va) < 0.005;
      if (settled) {
        m.a = m.goal;
        m.va = 0;
        if (!m.held) { m.s = 0; m.vs = 0; }
      }
      paint();
      if (!settled || dragging) m.raf = requestAnimationFrame(frame);
    };

    const kick = () => {
      if (m.raf) return;
      m.last = performance.now();
      m.raf = requestAnimationFrame(frame);
    };

    const refreshGoal = () => {
      m.goal = hovered || dragging || focused ? 1 : 0;
      kick();
    };

    const onWindowMove = event => {
      if (!dragging) return;
      const rect = input.getBoundingClientRect();
      const fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
      const over = fraction < 0 ? -fraction * rect.width : fraction > 1 ? (fraction - 1) * rect.width : 0;
      if (over > 0) {
        m.held = true;
        m.side = fraction < 0 ? -1 : 1;
        m.s = rubber(over, options.maxStretch);
        m.vs = 0;
      } else if (m.held) {
        m.held = false;
      }
      kick();
    };

    const release = () => {
      if (!dragging) return;
      dragging = false;
      m.held = false;
      window.removeEventListener("pointermove", onWindowMove, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      refreshGoal();
      if (options.onDragEnd) options.onDragEnd();
    };

    input.addEventListener("pointerenter", () => { hovered = true; refreshGoal(); });
    input.addEventListener("pointerleave", () => { hovered = false; refreshGoal(); });
    input.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      dragging = true;
      window.addEventListener("pointermove", onWindowMove, true);
      window.addEventListener("pointerup", release, true);
      window.addEventListener("pointercancel", release, true);
      refreshGoal();
      if (options.onDragStart) options.onDragStart();
    });
    input.addEventListener("focus", () => { focused = input.matches(":focus-visible"); refreshGoal(); });
    input.addEventListener("blur", () => { focused = false; refreshGoal(); });
    // A key press at either end gives the same little bump ElasticSlider gives.
    input.addEventListener("keydown", event => {
      const value = Number(input.value);
      const atMin = value <= Number(input.min || 0);
      const atMax = value >= Number(input.max || 100);
      const pushRight = event.key === "ArrowRight" || event.key === "ArrowUp";
      const pushLeft = event.key === "ArrowLeft" || event.key === "ArrowDown";
      if ((atMax && pushRight) || (atMin && pushLeft)) {
        if (m.held || Math.abs(m.vs) > 40 || Math.abs(m.s) > 2) return;
        m.side = pushRight ? 1 : -1;
        m.vs = options.maxStretch * 5.5;
        kick();
      }
    });
    paint();
    return { refresh: refreshGoal };
  };

  // Seek: hover preview bubble that follows the pointer, and live time while dragging.
  let hoverFraction = null;
  const placeBubble = fraction => {
    if (!bubble || !scrubWrap) return;
    const width = scrubWrap.clientWidth;
    const half = (bubble.offsetWidth || 48) / 2;
    const x = clamp(fraction * width, half, Math.max(half, width - half));
    bubble.textContent = durationSec > 0 ? formatTime(fraction * durationSec) : "--:--";
    bubble.style.left = `${x.toFixed(1)}px`;
  };
  const bubbleVisible = visible => {
    if (!bubble) return;
    if (gsap && !reduced()) {
      gsap.to(bubble, {
        opacity: visible ? 1 : 0,
        y: visible ? 0 : 4,
        scale: visible ? 1 : 0.92,
        xPercent: -50,
        duration: visible ? 0.18 : 0.14,
        ease: visible ? "power3.out" : "power2.out",
        overwrite: "auto",
      });
    } else {
      bubble.style.opacity = visible ? "1" : "0";
    }
  };

  if (seek) {
    if (gsap && bubble) gsap.set(bubble, { x: 0, xPercent: -50, y: 4, scale: 0.92 });
    elastic(seek, {
      cssVar: "--scrub-h",
      originVar: "--scrub-origin",
      thickness: 6,
      activeThickness: 12,
      maxStretch: 26,
      bounce: 0.5,
      onDragStart: () => { scrubbing = true; renderTimes(); bubbleVisible(true); },
      onDragEnd: () => {
        scrubbing = false;
        window.setTimeout(renderTimes, 120);
        if (hoverFraction === null) bubbleVisible(false);
      },
    });
    seek.addEventListener("pointermove", event => {
      const rect = seek.getBoundingClientRect();
      hoverFraction = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      if (!scrubbing) placeBubble(hoverFraction);
    });
    seek.addEventListener("pointerenter", () => bubbleVisible(true));
    seek.addEventListener("pointerleave", () => {
      hoverFraction = null;
      if (!scrubbing) bubbleVisible(false);
    });
    seek.addEventListener("input", () => {
      if (scrubbing) placeBubble(seekFraction());
      else if (hoverFraction !== null) placeBubble(hoverFraction);
      renderTimes();
    });
  }

  elastic(document.getElementById("volumeSlider"), {
    cssVar: "--vol-h",
    originVar: "--vol-origin",
    thickness: 6,
    activeThickness: 10,
    maxStretch: 18,
    bounce: 0.5,
  });

  // ---- ShinyText on the opening status line --------------------------------------------------

  const shine = element => {
    if (!element) return;
    // Values follow ShinyText's defaults, tuned to Apple's grey-to-white loading shimmer.
    const base = "rgba(235, 235, 245, .55)";
    const peak = "rgba(255, 255, 255, 1)";
    const width = 40;
    const softness = 0.8;
    const speed = 2.2;
    const delay = 0.4;
    const ease = t => 0.5 - Math.cos(Math.PI * t) / 2;
    let start = 0;
    let raf = 0;
    const paint = pos => {
      const half = width / 2;
      const core = half * (1 - softness);
      element.style.backgroundImage =
        `linear-gradient(120deg, ${base} 0%, ${base} ${(pos - half).toFixed(2)}%, ` +
        `${peak} ${(pos - core).toFixed(2)}%, ${peak} ${(pos + core).toFixed(2)}%, ` +
        `${base} ${(pos + half).toFixed(2)}%, ${base} 100%)`;
    };
    const tick = now => {
      raf = 0;
      if (!element.isConnected) return;
      const visible = element.offsetParent !== null;
      if (!visible || reduced()) {
        element.style.backgroundImage = `linear-gradient(${base}, ${base})`;
        window.setTimeout(() => { if (!raf) raf = requestAnimationFrame(tick); }, 500);
        return;
      }
      if (!start) start = now;
      const cycle = (speed + delay) * 1000;
      const t = ((now - start) % cycle) / (speed * 1000);
      paint(t <= 1 ? -width + ease(t) * (100 + width * 2) : 100 + width);
      raf = requestAnimationFrame(tick);
    };
    element.classList.add("v-shiny");
    raf = requestAnimationFrame(tick);
  };
  shine(document.getElementById("openingMessage"));

  if (!gsap) return;

  // ---- GSAP: chrome reveal ---------------------------------------------------------------------

  const ornament = document.getElementById("ornament");
  const metadata = document.querySelector(".progress .metadata");
  const headerActions = document.querySelector(".header-actions");
  let chromeHidden = root.classList.contains("chrome-hidden");

  const revealChrome = () => {
    if (reduced()) return;
    gsap.fromTo(ornament, { y: 16, scale: 0.985 }, { y: 0, scale: 1, duration: 0.55, ease: "expo.out", overwrite: "auto" });
    gsap.fromTo(metadata, { y: 10 }, { y: 0, duration: 0.55, delay: 0.04, ease: "expo.out", overwrite: "auto" });
    gsap.fromTo(headerActions, { y: -10 }, { y: 0, duration: 0.5, ease: "expo.out", overwrite: "auto" });
  };
  const hideChrome = () => {
    if (reduced()) return;
    gsap.to(ornament, { y: 8, scale: 0.995, duration: 0.24, ease: "power2.out", overwrite: "auto" });
    gsap.to(metadata, { y: 6, duration: 0.24, ease: "power2.out", overwrite: "auto" });
    gsap.to(headerActions, { y: -6, duration: 0.24, ease: "power2.out", overwrite: "auto" });
  };

  // ---- GSAP: panels ---------------------------------------------------------------------------

  const animatePanel = layer => {
    if (reduced()) return;
    const panel = layer.querySelector(".track-panel, .player-side-panel");
    if (!panel) return;
    const rows = Array.from(layer.querySelectorAll(".track-header, .subtitle-rail-title, .track-row, .style-section"))
      .filter(node => node.offsetParent !== null)
      .slice(0, 18);
    const targets = [panel, ...rows];
    targets.forEach(node => node.classList.add("v-animating"));
    const timeline = gsap.timeline({
      onComplete: () => {
        targets.forEach(node => node.classList.remove("v-animating"));
        gsap.set(targets, { clearProps: "transform,opacity" });
      },
    });
    const fromSide = layer.classList.contains("player-side-modal");
    timeline.fromTo(panel,
      fromSide ? { x: 40, opacity: 0 } : { y: 18, scale: 0.97, opacity: 0 },
      fromSide ? { x: 0, opacity: 1, duration: 0.45, ease: "expo.out" } : { y: 0, scale: 1, opacity: 1, duration: 0.45, ease: "expo.out" });
    if (rows.length) {
      timeline.fromTo(rows, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: "power3.out", stagger: 0.018 }, 0.06);
    }
  };

  // ---- GSAP: play / pause glyph -----------------------------------------------------------------

  const toggleIcon = document.getElementById("toggleIcon");
  const toggleSvg = toggleIcon ? toggleIcon.closest("svg") : null;
  let lastToggleHref = toggleIcon ? toggleIcon.getAttribute("href") : "";
  const swapToggle = () => {
    const href = toggleIcon.getAttribute("href");
    if (href === lastToggleHref) return;
    lastToggleHref = href;
    if (reduced() || !toggleSvg) return;
    gsap.fromTo(toggleSvg,
      { scale: 0.25, opacity: 0, filter: "blur(4px)" },
      { scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.3, ease: "power2.out", overwrite: "auto", clearProps: "filter" });
  };

  // ---- GSAP: toast --------------------------------------------------------------------------------

  const toast = document.getElementById("playerToast");
  let toastShown = toast ? toast.classList.contains("visible") : false;
  const popToast = () => {
    if (reduced()) return;
    toast.classList.add("v-animating");
    gsap.fromTo(toast, { y: -8, scale: 0.94 }, {
      y: 0, scale: 1, duration: 0.4, ease: "back.out(1.6)", overwrite: "auto",
      onComplete: () => toast.classList.remove("v-animating"),
    });
  };

  // ---- Subtitles step up above the controls while they are showing ------------------------------

  const progress = document.querySelector(".progress");
  let subLift = 0;
  const liftSubtitles = () => {
    const layer = document.querySelector(".sub-layer");
    const box = layer && layer.querySelector(".sub-box");
    if (!layer || !box || !progress) return;
    let target = 0;
    const chromeShown = !root.classList.contains("chrome-hidden") && !root.classList.contains("opening-active");
    if (chromeShown && box.dataset.empty !== "true" && !box.classList.contains("sub-dragging")) {
      const currentY = Number(gsap.getProperty(layer, "y")) || 0;
      const boxBottom = box.getBoundingClientRect().bottom - currentY;
      const controlsTop = progress.getBoundingClientRect().top;
      target = Math.max(0, Math.round(boxBottom - controlsTop + 16));
    }
    if (target === subLift) return;
    subLift = target;
    gsap.to(layer, {
      y: -target,
      duration: reduced() ? 0 : (target > 0 ? 0.5 : 0.35),
      ease: target > 0 ? "expo.out" : "power2.out",
      overwrite: "auto",
    });
  };

  const originalSubtitleText = window.playerSubtitleText;
  if (typeof originalSubtitleText === "function") {
    window.playerSubtitleText = text => {
      const result = originalSubtitleText(text);
      try { liftSubtitles(); } catch (error) { console.error("vision lift", error); }
      return result;
    };
  }
  window.addEventListener("resize", () => requestAnimationFrame(liftSubtitles));
  const originalControls = window.playerControls;
  if (typeof originalControls === "function") {
    window.playerControls = payload => {
      const result = originalControls(payload);
      requestAnimationFrame(() => { try { liftSubtitles(); } catch (error) { console.error("vision lift", error); } });
      return result;
    };
  }

  // ---- Observers --------------------------------------------------------------------------------

  new MutationObserver(() => {
    liftSubtitles();
    const hidden = root.classList.contains("chrome-hidden");
    if (hidden === chromeHidden) return;
    chromeHidden = hidden;
    if (hidden) hideChrome(); else revealChrome();
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
  requestAnimationFrame(liftSubtitles);

  document.querySelectorAll(".modal-layer").forEach(layer => {
    let visible = layer.classList.contains("modal-visible");
    new MutationObserver(() => {
      const now = layer.classList.contains("modal-visible") && !layer.classList.contains("modal-closing");
      if (now && !visible) requestAnimationFrame(() => animatePanel(layer));
      visible = now;
    }).observe(layer, { attributes: true, attributeFilter: ["class"] });
  });

  if (toggleIcon) {
    new MutationObserver(swapToggle).observe(toggleIcon, { attributes: true, attributeFilter: ["href"] });
  }

  if (toast) {
    new MutationObserver(() => {
      const shown = toast.classList.contains("visible");
      if (shown && !toastShown) popToast();
      toastShown = shown;
    }).observe(toast, { attributes: true, attributeFilter: ["class"] });
  }
})();
