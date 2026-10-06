// Countdown with ar-EG digits so the Amiri display face stays consistent.
import { CONFIG } from "../config.js";

const target = new Date(CONFIG.event.datetimeIso).getTime();
const fmt    = new Intl.NumberFormat("ar-EG");
const cells  = {
  days:    document.querySelector('[data-unit="days"]'),
  hours:   document.querySelector('[data-unit="hours"]'),
  minutes: document.querySelector('[data-unit="minutes"]'),
  seconds: document.querySelector('[data-unit="seconds"]'),
};
const wrap = document.getElementById("countdown");

function tick() {
  const diff = target - Date.now();
  if (diff <= 0) {
    wrap?.classList.add("celebrating");
    wrap?.setAttribute("aria-label", "اليوم مبارك");
    for (const el of Object.values(cells)) if (el) el.textContent = fmt.format(0);
    return;
  }
  const days    = Math.floor(diff / 86_400_000);
  const hours   = Math.floor((diff / 3_600_000) % 24);
  const minutes = Math.floor((diff / 60_000) % 60);
  const seconds = Math.floor((diff / 1_000) % 60);
  if (cells.days)    cells.days.textContent    = fmt.format(days);
  if (cells.hours)   cells.hours.textContent   = fmt.format(hours);
  if (cells.minutes) cells.minutes.textContent = fmt.format(minutes);
  if (cells.seconds) cells.seconds.textContent = fmt.format(seconds);
}

if (!Number.isNaN(target)) { tick(); setInterval(tick, 1000); }
