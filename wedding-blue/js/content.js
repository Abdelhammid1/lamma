// ============================================================================
//  Fills the sections from CONFIG, in Arabic: the verse and wreath, the
//  ceremony section, the reception section, venue, dress code, gift box.
//  Every text goes in via textContent. Sections whose data the host left
//  empty are hidden, never shown blank.
// ============================================================================

import { CONFIG } from "../config.js";
import { arDate, arTime } from "./arabic.js?v=32c7962b";

const $ = (id) => document.getElementById(id);
const set = (id, text) => { const el = $(id); if (el) el.textContent = text ?? ""; };
const each = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
const s = (v) => (typeof v === "string" ? v.trim() : "");

const couple = CONFIG.couple || {};
const kind = s(couple.eventType) || "زفاف";

/* ---------- Verse + wreath ---------- */
const verse = s(CONFIG.verse);
set("verse", verse);
if (!verse && $("verse")) $("verse").hidden = true;
set("eyebrow", `حفل ${kind}`);
set("ann-groom", couple.groom);
set("ann-bride", couple.bride);

/* ---------- Ceremony section ---------- */
const famG = s(CONFIG.families?.groom), famB = s(CONFIG.families?.bride);
set("family-groom", famG);
set("family-bride", famB);
if (!famG && !famB && $("families")) $("families").hidden = true;
else if ((!famG || !famB) && $("families")) $("families").classList.add("single");

const blessing = s(CONFIG.blessing);
set("ann-blessing", blessing);
if (!blessing && $("ann-blessing")) $("ann-blessing").hidden = true;

set("full-groom", s(couple.groomFull) || couple.groom);
set("full-bride", s(couple.brideFull) || couple.bride);

const when = new Date(CONFIG.event?.datetimeIso);
const valid = !isNaN(when);
const parts = valid ? arDate(when) : { dow: "—", day: "—", month: "—", year: "—", time: "—" };
each("[data-day]",   (el) => (el.textContent = parts.day));
each("[data-month]", (el) => (el.textContent = parts.month));
each("[data-year]",  (el) => (el.textContent = parts.year));
each("[data-dow]",   (el) => (el.textContent = parts.dow));
each('[data-time="ceremony"]', (el) => (el.textContent = parts.time));
// The form gives "HH:MM"; anything else the host typed is shown as typed.
const receptionTime = s(CONFIG.event?.receptionTime) ? arTime(CONFIG.event.receptionTime) : parts.time;
each('[data-time="reception"]', (el) => (el.textContent = receptionTime));

const ceremonyPlace = s(CONFIG.ceremony?.name);
set("ceremony-place", ceremonyPlace);
if (!ceremonyPlace && $("ceremony-block")) $("ceremony-block").hidden = true;
set("reception-place", s(CONFIG.venue?.name));

/* ---------- Reception section ---------- */
set("welcome-time", s(CONFIG.event?.welcomeTime) ? arTime(CONFIG.event.welcomeTime) : "—");
set("reception-time", receptionTime);

/* ---------- Venue ---------- */
const venue = CONFIG.venue || {};
set("venue-name", s(venue.name));
set("venue-address", s(venue.address));
const directions = $("venue-open");
if (directions) {
  const deep = s(venue.mapsDeepLink) || s(venue.mapsEmbedSrc);
  const query = [s(venue.name), s(venue.address)].filter(Boolean).join("، ");
  const href = /^https?:\/\//i.test(deep) ? deep
             : query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
             : "";
  if (href) directions.href = href; else directions.hidden = true;
}
if (!s(venue.name) && !s(venue.address) && $("venue")) $("venue").hidden = true;

/* ---------- Dress code ---------- */
const dress = CONFIG.dressCode || {};
const colors = (Array.isArray(dress.colors) ? dress.colors : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
set("dress-code-label", s(dress.label));
const row = $("dress-code-swatches");
if (row) {
  for (const hex of colors) {
    const dot = document.createElement("span");
    dot.className = "swatch";
    dot.style.background = hex;
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", `لون ${hex}`);
    row.appendChild(dot);
  }
}
if (!s(dress.label) && !colors.length && $("dress-code")) $("dress-code").hidden = true;

/* ---------- Gift box ---------- */
const giftMsg = s(CONFIG.gift?.message), giftDetails = s(CONFIG.gift?.details);
const gift = $("gift");
if (gift && (giftMsg || giftDetails)) {
  gift.hidden = false;
  set("gift-message", giftMsg);
  set("gift-details", giftDetails);
  const openBtn = $("gift-open"), card = $("gift-card"), copy = $("gift-copy");
  // The box always opens: it reveals the payment details when the host
  // gave them, otherwise the message itself (then not repeated below).
  if (!giftDetails) {
    set("gift-details", giftMsg);
    $("gift-message").hidden = true;
  }
  openBtn.addEventListener("click", () => {
    const open = !gift.classList.contains("open");
    gift.classList.toggle("open", open);
    openBtn.setAttribute("aria-expanded", String(open));
    card.hidden = !open;
    set("gift-hint", open ? "اضغط للإغلاق" : "اضغط للفتح");
  });
  if (giftDetails) {
    copy.hidden = false;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(giftDetails);
        copy.textContent = "تم النسخ ✓";
        setTimeout(() => (copy.textContent = "نسخ"), 1500);
      } catch (_) { /* clipboard blocked — the text is still selectable */ }
    });
  }
}
