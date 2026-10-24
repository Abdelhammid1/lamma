// ============================================================================
//  Cover: names + date on the card, floating hearts behind it, and the
//  Open button — the one user gesture that may start the music.
// ============================================================================

import { CONFIG } from "../config.js";

const $ = (id) => document.getElementById(id);

if ($("cover-groom")) $("cover-groom").textContent = CONFIG.couple.groom;
if ($("cover-bride")) $("cover-bride").textContent = CONFIG.couple.bride;
const when = new Date(CONFIG.event.datetimeIso);
if ($("cover-date") && !isNaN(when)) {
  $("cover-date").textContent = new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", year: "numeric",
  }).format(when);
}

/* ---------- Floating hearts (decorative; none when motion is reduced) --- */
const hearts = $("cover-hearts");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (hearts && !reduceMotion) {
  const COLORS = ["#c9a24a", "#e9d6c7", "#f3e8de", "#a8323b"];
  for (let i = 0; i < 16; i++) {
    const h = document.createElement("span");
    h.className = "heart";
    h.style.left = `${Math.random() * 100}%`;
    h.style.setProperty("--size", `${8 + Math.random() * 12}px`);
    h.style.setProperty("--dur", `${9 + Math.random() * 10}s`);
    h.style.setProperty("--delay", `${-Math.random() * 18}s`);
    h.style.setProperty("--drift", `${(Math.random() - 0.5) * 80}px`);
    h.style.color = COLORS[i % COLORS.length];
    h.style.opacity = String(0.25 + Math.random() * 0.45);
    hearts.appendChild(h);
  }
}

/* ---------- Music ---------- */
const audio    = $("bg-audio");
const musicBtn = $("music-toggle");
if (audio && CONFIG.music) {
  audio.src = CONFIG.music;
  audio.loop = true;
  audio.volume = 0.5;
  if (musicBtn) musicBtn.hidden = false;
}

/* ---------- Open ---------- */
const openBtn = $("open-btn");
if (openBtn) {
  openBtn.addEventListener("click", () => {
    if (document.body.classList.contains("opened")) return;
    if (audio && CONFIG.music) {
      audio.play().then(() => musicBtn && musicBtn.classList.add("playing"))
        .catch((err) => console.warn("bg music blocked:", err));
    }
    document.body.classList.add("opening");
    setTimeout(() => {
      document.body.classList.add("opened");
      window.scrollTo({ top: 0 });
    }, 650);
  });
}

if (musicBtn && audio) {
  musicBtn.addEventListener("click", async () => {
    if (audio.paused) {
      try { await audio.play(); musicBtn.classList.add("playing"); } catch (_) { /* ignore */ }
    } else {
      audio.pause();
      musicBtn.classList.remove("playing");
    }
  });
}
