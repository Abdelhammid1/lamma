// ============================================================================
//  Fills the static text bits in the Event Info section from CONFIG.
//  Interactive logic lives in countdown.js / calendar.js / ics.js / rsvp.js.
// ============================================================================

import { CONFIG } from "../config.js";

const set = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

const eventDate = new Date(CONFIG.event.datetimeIso);
const fmt = (opts) => new Intl.DateTimeFormat("en-US", opts).format(eventDate);

set("welcome-time",   CONFIG.event.welcomeTime);
set("reception-time", CONFIG.event.receptionTime);

// Reference layout: big party time + SUNDAY | 06 | SEPTEMBER + 2026
set("event-time-big", fmt({ hour: "numeric", minute: "2-digit", hour12: true }));
set("event-dow",      fmt({ weekday: "long"  }).toUpperCase());
set("event-day",      fmt({ day: "2-digit"   }));
set("event-mon",      fmt({ month: "long"    }).toUpperCase());
set("event-year",     fmt({ year: "numeric"  }));
