// ============================================================================
//  Countdown to CONFIG.event.datetimeIso — updates every second.
//  After the event starts, shows a "Celebrating now" state.
// ============================================================================

import { CONFIG } from "../config.js";

const target = new Date(CONFIG.event.datetimeIso).getTime();

const cells = {
  days:    document.querySelector('[data-unit="days"]'),
  hours:   document.querySelector('[data-unit="hours"]'),
  minutes: document.querySelector('[data-unit="minutes"]'),
  seconds: document.querySelector('[data-unit="seconds"]'),
};
const wrap = document.getElementById("countdown");

function tick() {
  const now = Date.now();
  const diff = target - now;

  if (diff <= 0) {
    if (wrap) {
      wrap.classList.add("celebrating");
      wrap.setAttribute("aria-label", "Celebrating now");
    }
    for (const el of Object.values(cells)) if (el) el.textContent = "0";
    return;
  }

  const days    = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours   = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  if (cells.days)    cells.days.textContent    = String(days);
  if (cells.hours)   cells.hours.textContent   = String(hours);
  if (cells.minutes) cells.minutes.textContent = String(minutes);
  if (cells.seconds) cells.seconds.textContent = String(seconds);
}

tick();
setInterval(tick, 1000);
