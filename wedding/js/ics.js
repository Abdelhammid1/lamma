// ============================================================================
//  Add-to-Calendar: build an .ics text blob in-browser from CONFIG.event
//  and hand it to the user as a download. No server or library required.
//  Fields conform to RFC 5545 minimal event requirements.
// ============================================================================

import { CONFIG } from "../config.js";

/** Convert a Date to UTC "YYYYMMDDTHHMMSSZ" — the .ics DATE-TIME format. */
function toIcsUtc(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    "T" +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    "Z"
  );
}

/** Escape commas, semicolons, and newlines per RFC 5545. */
function icsEscape(str) {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildIcs() {
  const start = new Date(CONFIG.event.datetimeIso);
  const end   = new Date(start.getTime() + (CONFIG.event.durationHours || 4) * 3600 * 1000);
  const now   = new Date();

  const uid = `${start.getTime()}-${CONFIG.couple.groom}-${CONFIG.couple.bride}@wedding-invite`
    .replace(/\s+/g, "");

  const summary  = `${CONFIG.couple.groom} & ${CONFIG.couple.bride} — ${CONFIG.couple.eventType}`;
  const location = `${CONFIG.venue.name}, ${CONFIG.venue.address}`;
  const desc     = CONFIG.blessing || "";

  // CRLF line endings are required by the spec.
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wedding Invitation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `LOCATION:${icsEscape(location)}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadIcs() {
  const blob = new Blob([buildIcs()], { type: "text/calendar;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${CONFIG.couple.groom}-${CONFIG.couple.bride}-${CONFIG.couple.eventType}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Free the object URL after the click has been processed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const btn = document.getElementById("ics-btn");
if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); downloadIcs(); });
