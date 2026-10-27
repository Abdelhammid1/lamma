// Countdown as one line of Arabic: "٤١٠ يوم ١٧ ساعة ٣٣ دقيقة ١٧ ثانية".
import { CONFIG } from "../config.js";
import { ar } from "./arabic.js?v=32c7962b";

const el = document.getElementById("countdown");
const target = new Date(CONFIG.event?.datetimeIso).getTime();

function tick() {
  if (!el) return;
  if (isNaN(target)) { el.textContent = "—"; return; }
  const diff = target - Date.now();
  if (diff <= 0) { el.textContent = "اليوم هو يوم الفرح ♥"; return; }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff / 3600000) % 24);
  const m = Math.floor((diff / 60000) % 60);
  const sec = Math.floor((diff / 1000) % 60);
  el.textContent = `${ar(d)} يوم ${ar(h)} ساعة ${ar(m)} دقيقة ${ar(sec)} ثانية`;
}
tick();
setInterval(tick, 1000);
