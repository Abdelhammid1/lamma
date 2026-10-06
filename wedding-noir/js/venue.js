// ============================================================================
//  Venue section: name/address text, Google Maps embed iframe src, and the
//  "Open in Maps" deep link — all pulled from CONFIG.venue.
// ============================================================================

import { CONFIG } from "../config.js";

const nameEl    = document.getElementById("venue-name");
const addressEl = document.getElementById("venue-address");
const iframe    = document.getElementById("venue-iframe");
const mapWrap   = document.querySelector(".venue-map");
const openLink  = document.getElementById("venue-open");

if (nameEl)    nameEl.textContent    = CONFIG.venue.name    || "";
if (addressEl) addressEl.textContent = CONFIG.venue.address || "";

// Customers often publish without filling the Google Maps embed URL or
// deep link — before this guard, the iframe just rendered a blank gray
// box and the "Open in Maps" button linked to "#". Hide each piece
// when its source is missing instead of showing a broken map.
const embedSrc = (CONFIG.venue.mapsEmbedSrc || "").trim();
if (iframe && embedSrc) {
  iframe.src = embedSrc;
} else if (mapWrap) {
  mapWrap.hidden = true;
}

const deepLink = (CONFIG.venue.mapsDeepLink || "").trim();
if (openLink) {
  if (deepLink) {
    openLink.href = deepLink;
  } else {
    openLink.hidden = true;
  }
}
