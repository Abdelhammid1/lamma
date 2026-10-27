// ============================================================================
//  Cover: names + Arabic date on the card, and the Open button — the one
//  user gesture that may start the music.
// ============================================================================

import { CONFIG } from "../config.js";
import { arDate } from "./arabic.js?v=32c7962b";

const $ = (id) => document.getElementById(id);

if ($("cover-groom")) $("cover-groom").textContent = CONFIG.couple.groom;
if ($("cover-bride")) $("cover-bride").textContent = CONFIG.couple.bride;
const when = new Date(CONFIG.event.datetimeIso);
if ($("cover-date") && !isNaN(when)) {
  const d = arDate(when);
  $("cover-date").textContent = `${d.dow} ${d.day} ${d.month} ${d.year}`;
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
