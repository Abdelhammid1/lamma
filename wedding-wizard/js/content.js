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
// One parchment card per program row, a gold line icon above each, in turn.
const ICONS = [
  // witch's hat
  '<path d="M6 34 C14 31 34 31 42 34 C40 37 8 37 6 34Z"/><path d="M12 33 C16 26 18 18 20 12 C23 5 29 4 33 6 C29 7 27 10 26 14 C25 20 28 27 33 32"/><path d="M16 29 C21 28 27 28 31 29"/>',
  // two rings
  '<circle cx="18" cy="26" r="9"/><circle cx="30" cy="26" r="9"/><path d="M15 15 l3 -5 3 5 M27 15 l3 -5 3 5"/>',
  // teacup with steam
  '<path d="M9 22 H35 V26 C35 32 30 36 24 36 H20 C14 36 9 32 9 26Z"/><path d="M35 24 C40 24 41 31 35 31"/><path d="M5 39 H39"/><path d="M17 17 C15 14 19 12 17 8 M23 17 C21 14 25 12 23 8 M29 17 C27 14 31 12 29 8"/>',
  // camera
  '<path d="M6 16 H14 L17 11 H27 L30 16 H38 V36 H6Z"/><circle cx="22" cy="26" r="6.5"/><circle cx="22" cy="26" r="2.5"/><path d="M32 20 h3"/>',
  // star
  '<path d="M22 6 l4.6 10 10.9 1.2 -8.1 7.4 2.3 10.7 -9.7 -5.5 -9.7 5.5 2.3 -10.7 -8.1 -7.4 10.9 -1.2z"/>',
  // castle tower
  '<path d="M10 38 H34 M13 38 V20 H31 V38 M13 20 V15 h4 v3 h4 v-3 h3 v3 h4 v-3 h3 v5 M22 15 V6 l6 3 -6 3 M19 38 v-7 a3 3 0 0 1 6 0 v7"/>',
];
const items = (Array.isArray(CONFIG.schedule) ? CONFIG.schedule : [])
  .filter((it) => it && s(it.time) && s(it.label));
const list = $("plan-list");
if (list && items.length) {
  items.forEach((it, i) => {
    const li = document.createElement("li");
    li.className = "plan-item reveal";
    li.style.setProperty("--i", String(i % 4));
    const icon = document.createElement("span");
    icon.className = "plan-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<svg viewBox="0 0 44 44">${ICONS[i % ICONS.length]}</svg>`;   // fixed markup, no host text
    const card = document.createElement("div");
    card.className = "plan-card";
    const time = document.createElement("div");
    time.className = "plan-time";
    time.textContent = ampm(it.time);
    const what = document.createElement("div");
    what.className = "plan-what";
    what.dir = "auto";
    what.textContent = s(it.label);
    card.append(time, what);
    if (s(it.detail)) {
      const detail = document.createElement("p");
      detail.className = "plan-detail";
      detail.dir = "auto";
      detail.textContent = s(it.detail);
      card.appendChild(detail);
    }
    li.append(icon, card);
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
