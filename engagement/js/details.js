// Details — the Save-The-Date card: big day number, month, welcome +
// reception times, and the ICS calendar download link. Also writes the
// "Our Story" paragraph from CONFIG.blessing.

import { CONFIG } from "../config.js";

const q = (id) => document.getElementById(id);

if (CONFIG.blessing) q("story-body").textContent = CONFIG.blessing;

const d = new Date(CONFIG.event.datetimeIso);
if (!Number.isNaN(d.getTime())) {
  const pad2 = (n) => String(n).padStart(2, "0");
  q("date-day").textContent   = pad2(d.getDate());
  q("date-month").textContent = new Intl.DateTimeFormat("en-US", {
    month: "long", year: "numeric",
  }).format(d);
}

q("welcome-time").textContent   = CONFIG.event.welcomeTime   || "";
q("reception-time").textContent = CONFIG.event.receptionTime || "";

/* ----- ICS calendar file ----- */
// Build a minimal .ics as a data URL — no round trip, works offline on
// the guest's phone. 2-hour default duration if the event's own
// durationHours isn't set.
function toIcsDate(d) {
  const pad2 = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) + "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) + "Z";
}

// RFC 5545 text-value escape. Order matters — backslash first, then
// the four special chars. Without CRLF -> `\n` the groom/bride/venue
// fields could inject arbitrary ICS lines (e.g. an attacker publishing
// a "name" of  `Rick\r\nATTENDEE:MAILTO:x@evil` would see a new ATTENDEE
// property smuggled into every guest's calendar). Also truncate at 400
// chars per field so an unusually long paste can't produce a line that
// a calendar app rejects as a protocol-violation.
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
  const end = new Date(d.getTime() + (CONFIG.event.durationHours || 2) * 60 * 60 * 1000);
  const summary  = `${CONFIG.couple.groom || ""} & ${CONFIG.couple.bride || ""} — ${CONFIG.couple.eventType || "Engagement"}`.trim();
  const location = [CONFIG.venue?.name, CONFIG.venue?.address].filter(Boolean).join(", ");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//lamma//engagement//EN",
    "BEGIN:VEVENT",
    `UID:${icsText(CONFIG.slug || "engagement")}@lamma.manasety.ai`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(d)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${icsText(summary)}`,
    location && `LOCATION:${icsText(location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  icsLink.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
}
