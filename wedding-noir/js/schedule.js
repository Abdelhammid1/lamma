// ============================================================================
//  Program / schedule — vertical timeline of event items. Reads
//  CONFIG.schedule which is an array of {time: "HH:MM", label: "…"}.
//  Each row is marked past / next / future vs the device clock so the
//  live state is visible to a guest looking at the invitation during
//  the event. If CONFIG.schedule is empty / missing, the section hides
//  so there's no "Program" header without content.
// ============================================================================

import { CONFIG } from "../config.js";

const section = document.getElementById("schedule");
const list    = document.getElementById("schedule-list");

const items = Array.isArray(CONFIG.schedule)
  ? CONFIG.schedule.filter((i) => i && typeof i.time === "string" && typeof i.label === "string" && i.time && i.label)
  : [];

if (!section || !list || !items.length) {
  if (section) section.hidden = true;
} else {
  section.hidden = false;

  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<":"&lt;",">":"&gt;","&":"&amp;" }[c]));

  // "19:00" → minutes since midnight; -1 for garbage.
  const toMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    return m ? (+m[1] * 60) + (+m[2]) : -1;
  };
  // "19:00" → "7:00 PM" (en-US style). Guests expect that even in Arabic.
  const fmtAmPm = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    if (!m) return t;
    let h = +m[1];
    const mm = m[2];
    const period = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${mm} ${period}`;
  };

  function render() {
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    let nextIdx = items.findIndex((it) => toMin(it.time) >= curMin);
    if (nextIdx < 0) nextIdx = items.length; // event's done — all rows past

    list.innerHTML = items.map((it, i) => {
      const state = i < nextIdx ? "past" : i === nextIdx ? "next" : "future";
      return `
        <li class="tl-row tl-${state}">
          <span class="tl-time">${esc(fmtAmPm(it.time))}</span>
          <span class="tl-marker" aria-hidden="true"></span>
          <span class="tl-label" dir="auto">${esc(it.label)}</span>
        </li>
      `;
    }).join("");
  }

  render();
  // Re-run every minute so the "next" state advances as the event
  // actually unfolds. The listener is a no-op cost (one tiny render).
  setInterval(render, 60 * 1000);
}
