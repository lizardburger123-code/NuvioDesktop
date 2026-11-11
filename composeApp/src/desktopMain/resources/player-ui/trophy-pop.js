/*
 * Trophy pop-ups over the video, the console way: the medal lands in the top-right corner, the
 * card opens beside it to say what was earned and fills the level bar, then folds away. The app
 * words the cards (film finished, season complete, badge, level) and sends them with the player
 * state; this only shows them, one after another.
 */
(() => {
  const TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/></svg>';
  const FRESH_MS = 30000;
  const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = ms => new Promise(resolve => setTimeout(resolve, reduce() ? Math.min(ms, 80) : ms));
  const esc = text => String(text == null ? "" : text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let seenVersion = null;
  let busy = false;
  let audio = null;
  const queue = [];

  const chime = tier => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const notes = tier === "platinum" ? [659, 880, 1319] : tier === "level" ? [587, 880] : [784, 1175];
      notes.forEach((frequency, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        const at = audio.currentTime + i * 0.11;
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.12, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + 1);
      });
    } catch (error) { /* sound is a nicety */ }
  };

  const node = () => {
    let pop = document.getElementById("trophy-pop");
    if (pop) return pop;
    pop = document.createElement("div");
    pop.id = "trophy-pop";
    pop.className = "tpop";
    pop.setAttribute("role", "status");
    pop.setAttribute("aria-live", "polite");
    document.body.appendChild(pop);
    return pop;
  };

  const medal = card => {
    if (card.kind === "level") return `<span class="tpop-level">${esc(card.level)}</span>`;
    if ((card.kind === "case" || card.kind === "season") && card.image) return `<img src="${esc(card.image)}" alt="">`;
    return TROPHY;
  };

  const show = async card => {
    const pop = node();
    pop.className = `tpop tpop-${card.kind}${card.image && card.kind !== "badge" && card.kind !== "level" ? " has-image" : ""} tier-${card.tier || "gold"}`;
    pop.innerHTML = `
      <span class="tpop-medal">${medal(card)}</span>
      <span class="tpop-text"><span class="tpop-in">
        <span class="tpop-kick">${esc(card.kicker)}</span>
        <span class="tpop-name" dir="auto">${esc(card.title)}</span>
        ${card.sub ? `<span class="tpop-sub" dir="auto">${esc(card.sub)}</span>` : ""}
      </span></span>
      ${card.to != null ? `<span class="tpop-xp"><i style="--from:${Number(card.from) || 0}%;--to:${Number(card.to) || 0}%"></i></span>` : ""}`;
    void pop.offsetWidth;
    pop.classList.add("is-in");
    if (card.sound !== false) chime(card.kind === "level" ? "level" : card.tier);
    await wait(460);
    pop.classList.add("is-open");
    await wait(3800);
    pop.classList.remove("is-open");
    await wait(460);
    pop.classList.remove("is-in");
    await wait(360);
  };

  const run = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) await show(queue.shift());
    busy = false;
  };

  const take = trophy => {
    if (!trophy || typeof trophy.version !== "number") return;
    if (trophy.version === seenVersion) return;
    seenVersion = trophy.version;
    const now = Date.now();
    (Array.isArray(trophy.cards) ? trophy.cards : [])
      .filter(card => card && (!card.at || now - card.at < FRESH_MS))
      .forEach(card => queue.push(card));
    run();
  };

  const previous = window.playerControls;
  if (typeof previous === "function") {
    window.playerControls = nextState => {
      previous(nextState);
      try { take(nextState && nextState.trophy); } catch (error) { /* never break the player */ }
    };
  }
})();
