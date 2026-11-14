(() => {
  const easing = value => {
    const x = Math.max(0, Math.min(1, value));
    let low = 0;
    let high = 1;
    let t = x;
    for (let index = 0; index < 20; index += 1) {
      const inverse = 1 - t;
      const position = 3 * inverse * inverse * t * .333 + 3 * inverse * t * t * .667 + t * t * t;
      if (Math.abs(position - x) < 1e-7) break;
      if (position < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return 3 * (1 - t) * t * t + t * t * t;
  };

  // Lite (perf.js): no animation frames. The spinner is a still arc that moves one step each time
  // the host pushes state (controls.js calls step(), five times a second), so it still shows life.
  const isLite = () => Boolean(window.playerPerf && window.playerPerf.isLite());
  const LITE_STEPS = 10;

  window.createLoadingIndicator = canvas => {
    const context = canvas.getContext("2d");
    let colors = ["#2f6fed"];
    let active = false;
    let animation = null;
    let startedAt = null;
    let liteStep = 0;
    let liteDrawn = false;

    // Sizes the bitmap to the canvas's box and returns that box in CSS pixels.
    const fit = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const density = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * density);
      const pixelHeight = Math.round(height * density);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(density, 0, 0, density, 0, 0);
      context.clearRect(0, 0, width, height);
      return { width, height };
    };

    const brush = (width, height) => {
      if (colors.length < 2) return colors[0];
      const gradient = context.createLinearGradient(0, 0, width, height);
      colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color));
      return gradient;
    };

    const draw = timestamp => {
      if (startedAt === null) startedAt = timestamp;
      const { width, height } = fit();
      const frame = ((timestamp - startedAt) % 2000) / 2000 * 60;
      const start = 99 * easing((frame - 10) / 50);
      const end = 1 + 99 * easing(frame / 50);
      const scale = Math.min(width, height) * .75 / 350;
      const startAngle = (-90 + frame / 60 * 363 + start * 3.6) * Math.PI / 180;
      const sweepAngle = (end - start) * 3.6 * Math.PI / 180;
      context.strokeStyle = brush(width, height);
      context.lineWidth = 50 * scale;
      context.lineCap = "round";
      context.beginPath();
      context.arc(width / 2, height / 2, 150 * scale, startAngle, startAngle + sweepAngle);
      context.stroke();
      animation = window.requestAnimationFrame(draw);
    };

    // Lite: a faint ring and a quarter arc at the current step.
    const drawStill = () => {
      const { width, height } = fit();
      const scale = Math.min(width, height) * .75 / 350;
      const radius = 150 * scale;
      context.strokeStyle = brush(width, height);
      context.lineWidth = 50 * scale;
      context.lineCap = "round";
      context.globalAlpha = .22;
      context.beginPath();
      context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
      const startAngle = -Math.PI / 2 + liteStep * Math.PI * 2 / LITE_STEPS;
      context.beginPath();
      context.arc(width / 2, height / 2, radius, startAngle, startAngle + Math.PI / 2);
      context.stroke();
      liteDrawn = true;
    };

    const updateAnimation = () => {
      if (active && !document.hidden && !isLite()) {
        if (animation === null) animation = window.requestAnimationFrame(draw);
      } else {
        window.cancelAnimationFrame(animation);
        animation = null;
        startedAt = null;
        if (!active) liteDrawn = false;
        else if (isLite() && !liteDrawn) drawStill();
      }
    };

    document.addEventListener("visibilitychange", updateAnimation);
    if (window.playerPerf) {
      window.playerPerf.onChange(() => {
        liteDrawn = false;
        updateAnimation();
      });
    }

    return {
      setActive(value) {
        active = value;
        updateAnimation();
      },
      setColors(value) {
        colors = value;
      },
      // Lite: one step per state push while the spinner shows.
      step() {
        if (!active || !isLite() || document.hidden) return;
        liteStep = (liteStep + 1) % LITE_STEPS;
        drawStill();
      },
    };
  };
})();
