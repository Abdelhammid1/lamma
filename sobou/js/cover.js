// Cover: baby name (CONFIG.couple.groom), parents line
// (CONFIG.couple.bride), formatted date in ar-EG, Open button.

import { CONFIG } from "../config.js";

const q = (id) => document.getElementById(id);

q("baby-name").textContent          = CONFIG.couple.groom || "";
q("cover-parents-names").textContent = CONFIG.couple.bride || "";
q("cover-sub").textContent          = CONFIG.couple.eventType || "سبوع";

const d = new Date(CONFIG.event.datetimeIso);
if (!Number.isNaN(d.getTime())) {
  q("cover-date").textContent = new Intl.DateTimeFormat("ar-EG", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(d);
}

const openBtn  = q("open-btn");
const scrollEl = q("scroll");
const audio    = q("bg-audio");
const toggle   = q("music-toggle");

openBtn?.addEventListener("click", () => {
  scrollEl.classList.add("revealed");
  scrollEl.setAttribute("aria-hidden", "false");
  window.scrollTo({
    top: scrollEl.getBoundingClientRect().top + window.scrollY - 10,
    behavior: "smooth",
  });

  const src = (CONFIG.music || "").trim();
  if (audio && src) {
    audio.src = src;
    audio.volume = 0.5;
    audio.play().then(() => { if (toggle) toggle.hidden = false; })
                .catch(() => { if (toggle) toggle.hidden = false; });
  }
});

toggle?.addEventListener("click", () => {
  if (!audio) return;
  if (audio.paused) {
    audio.play().catch(() => {});
    toggle.classList.remove("muted");
  } else {
    audio.pause();
    toggle.classList.add("muted");
  }
});
