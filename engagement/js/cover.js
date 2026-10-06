// Cover — groom/bride names, pretitle, date, and the Open button that
// reveals the rest. Also arms background-music playback inside the user
// gesture so iOS autoplay restrictions don't block it.

import { CONFIG } from "../config.js";

const q = (id) => document.getElementById(id);

const type = (CONFIG.couple.eventType || "Engagement").trim();
q("cover-pretitle").textContent = `to the ${type.toLowerCase()} of`;
q("couple-groom").textContent = CONFIG.couple.groom || "";
q("couple-bride").textContent = CONFIG.couple.bride || "";

const d = new Date(CONFIG.event.datetimeIso);
if (!Number.isNaN(d.getTime())) {
  q("cover-date").textContent = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(d).replace(/,/g, " ·");
}

const openBtn  = q("open-btn");
const scrollEl = q("scroll");
const audio    = q("bg-audio");
const toggle   = q("music-toggle");

openBtn?.addEventListener("click", () => {
  scrollEl.classList.add("revealed");
  scrollEl.setAttribute("aria-hidden", "false");
  // Scroll just below the fold so the first "Our Story" section lands
  // in the viewport without stealing visual focus from the hero names.
  const target = scrollEl.getBoundingClientRect().top + window.scrollY - 10;
  window.scrollTo({ top: target, behavior: "smooth" });

  const src = (CONFIG.music || "").trim();
  if (audio && src) {
    audio.src = src;
    audio.volume = 0.6;
    audio.play().then(() => {
      if (toggle) toggle.hidden = false;
    }).catch(() => {
      // Autoplay still blocked (strict policy) — reveal the toggle so
      // the guest can start playback manually.
      if (toggle) toggle.hidden = false;
    });
  }
});

toggle?.addEventListener("click", () => {
  if (!audio) return;
  if (audio.paused) {
    audio.play().catch(() => {});
    toggle.classList.remove("muted");
    toggle.setAttribute("aria-label", "Mute music");
  } else {
    audio.pause();
    toggle.classList.add("muted");
    toggle.setAttribute("aria-label", "Play music");
  }
});
