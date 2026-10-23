// ============================================================================
//  Announcement section: fills the event-type header and the couple's names
//  from CONFIG. Pure DOM population — visuals + animation are handled in CSS.
// ============================================================================

import { CONFIG } from "../config.js";

const set = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

set("ann-header",      `The ${CONFIG.couple.eventType} of`);
set("ann-groom",       CONFIG.couple.groom);
set("ann-bride",       CONFIG.couple.bride);
set("ann-groom-label", CONFIG.couple.groomLabel);
set("ann-bride-label", CONFIG.couple.brideLabel);

// The host's blessing / short message — collected by the create form
// but never shown on these two templates before (only in the .ics).
const blessingEl = document.getElementById("ann-blessing");
if (blessingEl && CONFIG.blessing) {
  blessingEl.textContent = CONFIG.blessing;
  blessingEl.hidden = false;
}
