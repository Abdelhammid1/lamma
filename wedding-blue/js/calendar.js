// The month of the day in Arabic: Saturday first (as in Egypt), Arabic
// digits, a heart drawn round the day.
import { CONFIG } from "../config.js";
import { ar } from "./arabic.js?v=32c7962b";

const root = document.getElementById("calendar");
const day = new Date(CONFIG.event?.datetimeIso);

if (root && !isNaN(day)) {
  const year = day.getFullYear(), month = day.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (new Date(year, month, 1).getDay() + 1) % 7;   // Saturday = 0

  const head = document.createElement("p");
  head.className = "cal-header";
  head.textContent = new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(day);
  const grid = document.createElement("div");
  grid.className = "cal-grid";
  for (const d of ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"]) {
    const el = document.createElement("span");
    el.className = "cal-dow";
    el.textContent = d;
    grid.appendChild(el);
  }
  for (let i = 0; i < lead; i++) grid.appendChild(document.createElement("span"));
  for (let d = 1; d <= days; d++) {
    const el = document.createElement("span");
    el.className = d === day.getDate() ? "cal-cell cal-event" : "cal-cell";
    if (d === day.getDate()) el.setAttribute("aria-label", `${ar(d)}، يوم الفرح`);
    el.textContent = ar(d);
    grid.appendChild(el);
  }
  root.replaceChildren(head, grid);
} else if (root) {
  root.hidden = true;
}
