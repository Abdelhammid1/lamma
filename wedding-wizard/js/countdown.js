// Countdown in four boxes: days, hours, minutes, seconds.
import { CONFIG } from "../config.js";

const $ = (id) => document.getElementById(id);
const target = new Date(CONFIG.event?.datetimeIso).getTime();
const boxes = $("countdown");

function tick() {
  if (!boxes || isNaN(target)) return true;
  const diff = target - Date.now();
  if (diff <= 0) {
    boxes.hidden = true;
    $("countdown-done").hidden = false;
    return true;
  }
  $("cd-days").textContent  = String(Math.floor(diff / 86400000));
  $("cd-hours").textContent = String(Math.floor((diff / 3600000) % 24));
  $("cd-mins").textContent  = String(Math.floor((diff / 60000) % 60));
  $("cd-secs").textContent  = String(Math.floor((diff / 1000) % 60));
  return false;
}

if (!tick()) {
  const timer = setInterval(() => { if (tick()) clearInterval(timer); }, 1000);
}
