// Venue — name + address text, Google Maps iframe, Open-in-Maps link.
// All three gracefully hide when the respective CONFIG field is empty.

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
