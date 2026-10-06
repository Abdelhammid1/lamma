// Cover: couple names, formatted Arabic date on the cover, open button.
// Date formatting uses `ar-EG` locale with the Gregorian calendar so
// the invitation reads naturally for Egyptian guests ("السبت ١٤ نوفمبر
// ٢٠٢٦") while the underlying ISO timestamp stays unambiguous.

import { CONFIG } from "../config.js";

const q = (id) => document.getElementById(id);

q("couple-groom").textContent = CONFIG.couple.groom || "";
q("couple-bride").textContent = CONFIG.couple.bride || "";

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
    audio.play().then(() => {
      if (toggle) toggle.hidden = false;
    }).catch(() => {
      if (toggle) toggle.hidden = false;
    });
  }
});

toggle?.addEventListener("click", () => {
  if (!audio) return;
  if (audio.paused) {
    audio.play().catch(() => {});
    toggle.classList.remove("muted");
    toggle.setAttribute("aria-label", "إيقاف الموسيقى");
  } else {
    audio.pause();
    toggle.classList.add("muted");
    toggle.setAttribute("aria-label", "تشغيل الموسيقى");
  }
});
