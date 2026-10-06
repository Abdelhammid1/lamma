// ============================================================================
//  Cover / landing behavior:
//    - Fill in couple names + event date from CONFIG
//    - Open button: flower burst + smooth cover→invitation transition,
//      and starts background music (INSIDE the user gesture so browsers
//      don't block autoplay)
//    - Music toggle: flips audio.muted at any point after the first Open
// ============================================================================

import { CONFIG } from "../config.js";

/* ---------- Populate cover text ---------- */
const groomEl = document.getElementById("cover-groom");
const brideEl = document.getElementById("cover-bride");
const dateEl  = document.getElementById("cover-date");

if (groomEl) groomEl.textContent = CONFIG.couple.groom;
if (brideEl) brideEl.textContent = CONFIG.couple.bride;

if (dateEl) {
  const d = new Date(CONFIG.event.datetimeIso);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  dateEl.textContent = fmt.format(d);
}

/* ---------- Audio element setup (no .play() yet — waits for user gesture) ---- */
const audio    = document.getElementById("bg-audio");
const musicBtn = document.getElementById("music-toggle");

if (audio) {
  if (CONFIG.music) audio.src = CONFIG.music;
  audio.loop    = true;
  audio.volume  = 0.5;
  audio.preload = "auto";
}

/* ---------- Flower burst helper ---------- */
const PETAL_GLYPHS = ["🌸", "🌷", "🌹", "✿", "❀", "🪷"];

function spawnFlowerBurst(anchorEl) {
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const cx   = rect.left + rect.width  / 2;
  const cy   = rect.top  + rect.height / 2;

  const count = 14;
  for (let i = 0; i < count; i++) {
    const petal = document.createElement("span");
    petal.className   = "petal-burst-petal";
    petal.textContent = PETAL_GLYPHS[Math.floor(Math.random() * PETAL_GLYPHS.length)];

    const angle = Math.random() * Math.PI * 2;
    const dist  = 80 + Math.random() * 140;             // 80–220 px
    const tx    = Math.cos(angle) * dist;
    const ty    = Math.sin(angle) * dist;
    const rot   = (Math.random() * 1440) - 720;          // ±720 deg
    const dur   = 0.9 + Math.random() * 0.6;             // 0.9–1.5 s
    const sz    = 18  + Math.random() * 10;              // 18–28 px

    petal.style.left = cx + "px";
    petal.style.top  = cy + "px";
    petal.style.setProperty("--tx",  tx  + "px");
    petal.style.setProperty("--ty",  ty  + "px");
    petal.style.setProperty("--r",   rot + "deg");
    petal.style.setProperty("--dur", dur + "s");
    petal.style.setProperty("--sz",  sz  + "px");

    petal.addEventListener("animationend", () => petal.remove(), { once: true });
    document.body.appendChild(petal);
  }
}

/* ---------- Open button — the single user-gesture entry point ---------- */
const openBtn = document.getElementById("open-btn");
if (openBtn) {
  openBtn.addEventListener("click", () => {
    // Guard against double-taps replaying the burst and restarting music.
    if (document.body.classList.contains("opened")) return;

    // 1. Non-blocking burst — fires immediately, parallel to the fade.
    spawnFlowerBurst(openBtn);

    // 2. Start background music INSIDE the user gesture (autoplay-safe).
    if (audio) {
      audio.muted = false;
      audio.play().catch((err) => console.warn("bg music blocked:", err));
      if (musicBtn) musicBtn.classList.add("playing");
    }

    // 3. Existing cover → invitation transition.
    document.body.classList.add("opened");
    setTimeout(() => {
      const target = document.getElementById("invitation");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 500);
  });
}

/* ---------- Music toggle (mute/unmute after first Open) ---------- */
if (musicBtn && audio) {
  musicBtn.addEventListener("click", async () => {
    audio.muted = !audio.muted;
    musicBtn.classList.toggle("playing", !audio.muted);
    // If the element was never started (e.g. toggle tapped before Open),
    // .play() here is inside a user gesture — safe to try. Fail silently.
    if (!audio.muted) {
      try { await audio.play(); } catch (_) { /* ignore */ }
    }
  });
}
