// Details — greeting body, big date chip, welcome/reception times,
// ICS download. Same escape pattern as the engagement/qiraya templates
// so a hostile baby or parents name can't inject calendar lines.

import { CONFIG } from "../config.js";

const q = (id) => document.getElementById(id);

if (CONFIG.blessing) q("greeting-body").textContent = CONFIG.blessing;

const d = new Date(CONFIG.event.datetimeIso);
if (!Number.isNaN(d.getTime())) {
  const arFmt = (opts) => new Intl.DateTimeFormat("ar-EG", opts).format(d);
  q("date-day").textContent   = arFmt({ day: "2-digit" });
  q("date-month").textContent = arFmt({ month: "long" });
  q("date-year").textContent  = arFmt({ year: "numeric" });
}

q("welcome-time").textContent   = CONFIG.event.welcomeTime   || "";
q("reception-time").textContent = CONFIG.event.receptionTime || "";

function toIcsUtc(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "T" +
         p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z";
}
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
  const summary  = `سبوع ${CONFIG.couple.groom || ""}`.trim();
  const location = [CONFIG.venue?.name, CONFIG.venue?.address].filter(Boolean).join(", ");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//lamma//sobou//EN",
    "BEGIN:VEVENT",
    `UID:${icsText(CONFIG.slug || "sobou")}@lamma.manasety.ai`,
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
