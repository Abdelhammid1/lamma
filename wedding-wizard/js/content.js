// ============================================================================
//  Fills the slides from CONFIG: the letter, the venue, the grand day
//  (calendar + times), the day's plan, the dress code and the two RSVP
//  choices. Every text goes in via textContent. Slides whose data the host
//  left empty are hidden, never shown blank.
// ============================================================================

import { CONFIG } from "../config.js";

const $ = (id) => document.getElementById(id);
const set = (id, text) => { const el = $(id); if (el) el.textContent = text ?? ""; };
const s = (v) => (typeof v === "string" ? v.trim() : "");

// "19:00" → "7:00 PM"; anything else as typed.
function ampm(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s(t));
  if (!m) return s(t);
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

/* ---------- The letter ---------- */
const blessing = s(CONFIG.blessing);
if (blessing) set("letter-text", blessing);

/* ---------- Venue ---------- */
const venue = CONFIG.venue || {};
set("venue-name", s(venue.name));
set("venue-address", s(venue.address));
if (!s(venue.address) && $("venue-address")) $("venue-address").hidden = true;
const welcome = s(CONFIG.event?.welcomeTime);
if (welcome) {
  set("doors-time", ampm(welcome));
  $("doors").hidden = false;
}
const directions = $("venue-open");
if (directions) {
  const deep = s(venue.mapsDeepLink) || s(venue.mapsEmbedSrc);
  const query = [s(venue.name), s(venue.address)].filter(Boolean).join(", ");
  const href = /^https?:\/\//i.test(deep) ? deep
             : query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
             : "";
  if (href) directions.href = href; else directions.hidden = true;
}
if (!s(venue.name) && !s(venue.address) && $("venue")) $("venue").hidden = true;

/* ---------- The grand day ---------- */
const when = new Date(CONFIG.event?.datetimeIso);
const valid = !isNaN(when);
if (valid) {
  const pad = (n) => String(n).padStart(2, "0");
  const dow = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(when).toUpperCase();
  set("date-line", `${dow}, ${pad(when.getDate())}.${pad(when.getMonth() + 1)}.${when.getFullYear()}`);
  set("begin-time", new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(when));
  renderCalendar(when);
} else if ($("grand-day")) {
  $("grand-day").hidden = true;
}

// The month of the day, Sunday first, a heart drawn round the day.
function renderCalendar(day) {
  const root = $("calendar");
  if (!root) return;
  const year = day.getFullYear(), month = day.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const head = document.createElement("p");
  head.className = "cal-month";
  head.textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(day);
  const grid = document.createElement("div");
  grid.className = "cal-grid";
  for (const d of ["S", "M", "T", "W", "T", "F", "S"]) {
    const el = document.createElement("span");
    el.className = "cal-dow";
    el.textContent = d;
    grid.appendChild(el);
  }
  for (let i = 0; i < first; i++) grid.appendChild(document.createElement("span"));
  for (let d = 1; d <= days; d++) {
    const el = document.createElement("span");
    el.className = d === day.getDate() ? "cal-day cal-event" : "cal-day";
    if (d === day.getDate()) el.setAttribute("aria-label", `${d}, the day`);
    el.textContent = String(d);
    grid.appendChild(el);
  }
  root.replaceChildren(head, grid);
}

/* ---------- The day's plan ---------- */
// One card per program row, an icon from this set in turn.
const ICONS = [
  '<path d="M4 19h16M7 19l3-14 7 5-3 1 2 8"/>',                                    // hat
  '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5"/>',                 // rings
  '<path d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11h1.5a2 2 0 0 1 0 4H16M8 4c0 2 2 2 2 4M12 4c0 2 2 2 2 4M3 21h16"/>', // cup
  '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',        // camera
  '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>', // star
  '<path d="M5 20h14M7 20V10l5-6 5 6v10M10 20v-5h4v5"/>',                           // tower
];
const items = (Array.isArray(CONFIG.schedule) ? CONFIG.schedule : [])
  .filter((it) => it && s(it.time) && s(it.label));
const list = $("plan-list");
if (list && items.length) {
  items.forEach((it, i) => {
    const li = document.createElement("li");
    li.className = "plan-card reveal";
    li.style.setProperty("--i", String(i % 2));
    const icon = document.createElement("span");
    icon.className = "plan-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[i % ICONS.length]}</svg>`;   // fixed markup, no host text
    const time = document.createElement("div");
    time.className = "plan-time";
    time.textContent = ampm(it.time);
    const what = document.createElement("div");
    what.className = "plan-what";
    what.dir = "auto";
    what.textContent = s(it.label);
    li.append(icon, time, what);
    list.appendChild(li);
  });
  $("plan").hidden = false;
}

/* ---------- Dress code ---------- */
const dress = CONFIG.dressCode || {};
const colors = (Array.isArray(dress.colors) ? dress.colors : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
set("dress-code-label", s(dress.label));
if (!s(dress.label) && $("dress-code-label")) $("dress-code-label").hidden = true;
const row = $("dress-code-swatches");
if (row) {
  for (const hex of colors) {
    const dot = document.createElement("span");
    dot.className = "swatch";
    dot.style.background = hex;
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", `Colour ${hex}`);
    row.appendChild(dot);
  }
  if (!colors.length) row.hidden = true;
}
if (s(dress.note)) {
  set("dress-note", s(dress.note));
  $("dress-note-block").hidden = false;
}
if (!s(dress.label) && !colors.length && !s(dress.note) && $("dress-code")) $("dress-code").hidden = true;

/* ---------- RSVP: the two choices open the reply ---------- */
const form = $("rsvp-form");
// After a reply is sent the shared module resets the form (back to "yes"):
// drop the highlight so it doesn't point at the other answer.
form?.addEventListener("reset", () =>
  document.querySelectorAll("#rsvp-choice .is-picked").forEach((b) => b.classList.remove("is-picked")));
document.querySelectorAll("#rsvp-choice [data-attend]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!form) return;
    const value = btn.dataset.attend;
    const radio = form.querySelector(`input[name="attending"][value="${value}"]`);
    if (radio && !radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));   // the shared module hides the guest count
    }
    document.querySelectorAll("#rsvp-choice [data-attend]").forEach((b) =>
      b.classList.toggle("is-picked", b === btn));
    form.hidden = false;
    $("rsvp-name")?.focus({ preventScroll: true });
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  });
});
