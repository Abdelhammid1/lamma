// Venue — same empty-state logic as wedding/engagement: hide the map
// iframe wrapper when mapsEmbedSrc is blank, hide the Open in Maps
// button when mapsDeepLink is blank. The couple's address text still
// renders either way.

import { CONFIG } from "../config.js";

const q = (id) => document.getElementById(id);

const nameEl    = q("venue-name");
const addressEl = q("venue-address");
const iframe    = q("venue-iframe");
const mapWrap   = q("venue-map");
const openLink  = q("venue-open");

if (nameEl)    nameEl.textContent    = CONFIG.venue?.name    || "";
if (addressEl) addressEl.textContent = CONFIG.venue?.address || "";

const embed = (CONFIG.venue?.mapsEmbedSrc || "").trim();
if (iframe && embed) {
  iframe.src = embed;
} else if (mapWrap) {
  mapWrap.hidden = true;
}

const deepLink = (CONFIG.venue?.mapsDeepLink || "").trim();
if (openLink) {
  if (deepLink) openLink.href = deepLink;
  else openLink.hidden = true;
}
