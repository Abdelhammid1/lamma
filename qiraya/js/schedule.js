// ============================================================================
//  Program / schedule — vertical timeline with layered animation:
//
//    - On first scroll into view (one-shot "entered" state):
//        * A thin accent clock-hand sweeps top → bottom (1.2s).
//        * Each marker drops in from above with a brief ripple ring
//          whose delay times with the sweep crossing it, so there's a
//          cause/effect feel.
//    - Permanent, after entry:
//        * The dashed line between PAST items becomes solid progress
//          fill (visual "done" vs "coming"). Height recomputed every
//          60s so the fill grows during the event.
//        * A soft candle-light glow drifts top → bottom forever along
//          the line (6s loop) — subtle, respects reduced motion.
//        * The "next" marker keeps its hollow pulsing ring.
//
//  CONFIG.schedule is the data: [{ time: "HH:MM", label: "…" }, …].
//  If the array is empty or the elements are missing the renderer
//  hides the whole section so there's no orphan header.
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

  // "HH:MM" → minutes since midnight; -1 for garbage.
  const toMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    return m ? (+m[1] * 60) + (+m[2]) : -1;
  };
  // "19:00" → "7:00 PM" (same en-US style guests expect in Arabic).
  const fmtAmPm = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    if (!m) return t;
    let h = +m[1];
    const mm = m[2];
    const period = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${mm} ${period}`;
  };

  // ------------------------- render ----------------------------------
  // Full rebuild on first run and on every 60s state tick. The injected
  // helper divs (progress / candle / sweep) are preserved across tick
  // re-renders — only the row list is swapped out.
  function render() {
    const now    = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    let nextIdx  = items.findIndex((it) => toMin(it.time) >= curMin);
    if (nextIdx < 0) nextIdx = items.length;

    const rowsHtml = items.map((it, i) => {
      const state = i < nextIdx ? "past" : i === nextIdx ? "next" : "future";
      return `
        <li class="tl-row tl-${state}" style="--i:${i}">
          <span class="tl-time">${esc(fmtAmPm(it.time))}</span>
          <span class="tl-marker" aria-hidden="true"></span>
          <span class="tl-label" dir="auto">${esc(it.label)}</span>
        </li>
      `;
    }).join("");

    // Keep the helper children (progress / candle / sweep) by removing
    // only <li> nodes before injecting the new ones.
    list.querySelectorAll("li.tl-row").forEach((n) => n.remove());
    list.insertAdjacentHTML("beforeend", rowsHtml);
    updateProgress();
  }

  // ------------------------- progress fill ---------------------------
  // Fraction of the way through the whole program (first row 0%, last
  // row 100%). CSS turns the dashed line into a solid segment of that
  // height from the top. Clamped so a before-first-item view shows no
  // fill (0%) and an after-last-item view shows a complete line (100%).
  function updateProgress() {
    const first = toMin(items[0].time);
    const last  = toMin(items[items.length - 1].time);
    const now   = new Date();
    const cur   = now.getHours() * 60 + now.getMinutes();
    let pct = 0;
    if (last > first) pct = Math.max(0, Math.min(100, ((cur - first) / (last - first)) * 100));
    else if (cur >= first) pct = 100;
    list.style.setProperty("--tl-progress", pct + "%");
  }

  // ------------------------- helper injection ------------------------
  // Inject the three helper <div>s once. CSS positions them absolutely
  // against the <ol>, so they share the same coordinate system as the
  // dashed ::before line without interfering with layout.
  function injectHelpers() {
    if (list.querySelector(".tl-progress")) return;
    const parts = ["tl-progress", "tl-candle", "tl-sweep"];
    for (const cls of parts) {
      const d = document.createElement("div");
      d.className = cls;
      d.setAttribute("aria-hidden", "true");
      list.appendChild(d);
    }
  }

  injectHelpers();
  render();

  // ------------------------- entry sequence --------------------------
  // One-shot: when the section first enters the viewport, flip
  // .entered on the section — all the entry animations (sweep + per-
  // row drop + ripple) are keyed to that class in CSS.
  // Fire the entry sequence the first time the section is actually
  // visible in the viewport. IntersectionObserver would be ideal here
  // but the schedule renders inside #invitation which starts with
  // max-height:0; some engines then never re-check IO after the
  // body.opened CSS flip even though the section becomes visible.
  // A plain rect check on scroll + an initial check covers both cases.
  function checkEnter() {
    if (section.classList.contains("entered")) return;
    const r = section.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    // Fire when the top of the card has risen into the bottom 90% of
    // the viewport — gives the entry animation room before the user
    // is reading it, without being so eager it plays off-screen.
    if (r.top < vh * 0.9 && r.bottom > 20) {
      section.classList.add("entered");
      window.removeEventListener("scroll", checkEnter);
      window.removeEventListener("resize", checkEnter);
    }
  }
  window.addEventListener("scroll", checkEnter, { passive: true });
  window.addEventListener("resize", checkEnter);
  // One initial check for the case where the schedule is already in
  // view (short pages / landing on an open invitation link).
  requestAnimationFrame(checkEnter);

  // Advance the "next" state every 60s during the event. Full rebuild
  // keeps the row DOM in sync with current time; the entered class is
  // already set so no re-animation of the entry sequence.
  setInterval(render, 60 * 1000);
}
