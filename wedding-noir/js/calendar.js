// ============================================================================
//  Small calendar widget: renders the month containing CONFIG.event.datetimeIso
//  as a 7-column grid (Sunday-first). Highlights the event day.
// ============================================================================

import { CONFIG } from "../config.js";

const root = document.getElementById("calendar");
if (root) {
  const event    = new Date(CONFIG.event.datetimeIso);
  const year     = event.getFullYear();
  const month    = event.getMonth();          // 0-based
  const eventDay = event.getDate();

  const firstDay    = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Convert Sunday-start (0..6) to Monday-start (0..6 where Monday=0, Sunday=6)
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const monthName    = firstDay.toLocaleString("en-US", { month: "long" });

  const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  // Header + weekday row + day cells (leading blanks for offset)
  const html = [];
  html.push(`<div class="cal-header">${monthName} ${year}</div>`);
  html.push(`<div class="cal-grid">`);
  for (const d of DOW) html.push(`<div class="cal-dow">${d}</div>`);
  for (let i = 0; i < startWeekday; i++) html.push(`<div class="cal-cell cal-blank"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const isEvent = d === eventDay;
    html.push(
      `<div class="cal-cell${isEvent ? " cal-event" : ""}"` +
      (isEvent ? ` aria-label="Event day"` : "") +
      `>${d}</div>`
    );
  }
  html.push(`</div>`);
  root.innerHTML = html.join("");
}
