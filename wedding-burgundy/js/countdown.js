// Countdown as one line of text: "240 days 11 hours 0 min 24 sec".
import { CONFIG } from "../config.js";

const el = document.getElementById("countdown");
const target = new Date(CONFIG.event?.datetimeIso).getTime();

function tick() {
  if (!el) return;
  if (isNaN(target)) { el.textContent = "—"; return; }
  const diff = target - Date.now();
  if (diff <= 0) { el.textContent = "Today is the day ♥"; return; }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff / 3600000) % 24);
  const m = Math.floor((diff / 60000) % 60);
  const sec = Math.floor((diff / 1000) % 60);
  el.textContent = `${d} days ${h} hours ${m} min ${sec} sec`;
}
tick();
setInterval(tick, 1000);
