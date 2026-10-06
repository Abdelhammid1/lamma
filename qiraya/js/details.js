// Fills the Verse, Details card, Blessing text, and the ICS download
// link from CONFIG. Uses the ar-EG locale so date numbers come out as
// Arabic-Indic digits (١٤) which match the Amiri display face.

import { CONFIG } from "../config.js";

const q = (id) => document.getElementById(id);

/* ----- Verse (optional) ----- */
// Only shown if the family provided a quote. Hiding the whole section
// here (rather than at render time) keeps the layout tight for anyone
// who leaves the field blank.
const quote = (CONFIG.quote || "").trim();
const verseSec = q("verse");
if (quote && verseSec) {
  verseSec.hidden = false;
  q("verse-text").textContent   = quote;
  q("verse-source").textContent = (CONFIG.quoteSource || "").trim();
}

/* ----- Blessing / "كلمة الأهل" ----- */
if (CONFIG.blessing) q("blessing-body").textContent = CONFIG.blessing;

/* ----- Date card ----- */
const d = new Date(CONFIG.event.datetimeIso);
if (!Number.isNaN(d.getTime())) {
  const arFmt = (opts) => new Intl.DateTimeFormat("ar-EG", opts).format(d);
  q("date-day").textContent   = arFmt({ day: "2-digit" });
  q("date-month").textContent = arFmt({ month: "long", year: "numeric" });
  q("date-dow").textContent   = arFmt({ weekday: "long" });
}

q("welcome-time").textContent   = CONFIG.event.welcomeTime   || "";
q("reception-time").textContent = CONFIG.event.receptionTime || "";

/* ----- ICS calendar file ----- */
function toIcsUtc(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) + "T" +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) + "Z";
}

// RFC 5545 escape: backslash first, then the specials, then every
// variant of newline flattened to the ICS `\n` literal so the untrusted
// couple name / venue text can't smuggle extra calendar properties.
function icsText(s) {
  return String(s || "")
    .slice(0, 400)
    .replace(/\\/g, "\\\\")
    .replace(/;/g,  "\\;")
    .replace(/,/g,  "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const icsLink = q("ics-link");
if (icsLink && !Number.isNaN(d.getTime())) {
  const end = new Date(d.getTime() + (CONFIG.event.durationHours || 2) * 3600 * 1000);
  const summary  = `${CONFIG.couple.groom || ""} و ${CONFIG.couple.bride || ""} — ${CONFIG.couple.eventType || "قراية فاتحة"}`.trim();
  const location = [CONFIG.venue?.name, CONFIG.venue?.address].filter(Boolean).join(", ");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//lamma//qiraya//EN",
    "BEGIN:VEVENT",
    `UID:${icsText(CONFIG.slug || "qiraya")}@lamma.manasety.ai`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(d)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${icsText(summary)}`,
    location && `LOCATION:${icsText(location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  icsLink.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
}
