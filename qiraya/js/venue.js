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

// Convert a /maps/place/* share URL into a working embed URL (Google
// refuses to iframe share URLs). See wedding/js/venue.js for details.
function _toEmbedUrl(raw) {
  if (!raw) return "";
  if (/\/maps\/embed/i.test(raw)) return raw;
  const m = raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return `https://www.google.com/maps?q=${m[1]},${m[2]}&z=16&output=embed`;
  return `https://www.google.com/maps?q=${encodeURIComponent(raw)}&output=embed`;
}
const embed = _toEmbedUrl((CONFIG.venue?.mapsEmbedSrc || "").trim());
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
