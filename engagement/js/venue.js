// Venue — name + address text, Google Maps iframe, Open-in-Maps link.
// All three gracefully hide when the respective CONFIG field is empty.

import { CONFIG } from "../config.js";
import { toEmbedUrl } from "/js/shared/maps.js?v=aa88eecc";

const q = (id) => document.getElementById(id);

const nameEl    = q("venue-name");
const addressEl = q("venue-address");
const iframe    = q("venue-iframe");
const mapWrap   = q("venue-map");
const openLink  = q("venue-open");

if (nameEl)    nameEl.textContent    = CONFIG.venue?.name    || "";
if (addressEl) addressEl.textContent = CONFIG.venue?.address || "";

// Google refuses to iframe a /maps/place/* share URL (X-Frame-Options:
// SAMEORIGIN). Convert any non-embed URL into a working embed URL at
// render time so hosts who paste the regular share URL still get a map.
const embed = toEmbedUrl((CONFIG.venue?.mapsEmbedSrc || "").trim(), CONFIG.venue);
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
