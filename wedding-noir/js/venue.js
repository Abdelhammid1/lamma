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
// Google refuses to iframe a /maps/place/* share URL (X-Frame-Options:
// SAMEORIGIN). Hosts routinely paste that URL instead of the Share →
// Embed one, and the result is a broken-image icon where the map
// should be. Convert any non-embed URL into a working embed URL at
// render time so already-published events start working too.
function _toEmbedUrl(raw, venue) {
  if (!raw) return "";
  const embed = (q) => `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  // Already a Google Maps embed URL — keep as-is.
  if (/\/maps\/embed/i.test(raw)) return raw;
  // @lat,lng from a /maps/place/.../@LAT,LNG,zoom/ URL.
  const m = raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return `https://www.google.com/maps?q=${m[1]},${m[2]}&z=16&output=embed`;
  try {
    const u = new URL(raw);
    const q = u.searchParams.get("q") || u.searchParams.get("query");
    if (q) return embed(q);
    const place = u.pathname.match(/\/maps\/place\/([^/]+)/);
    if (place) return embed(decodeURIComponent(place[1].replace(/\+/g, " ")));
  } catch (_) {
    // Not a URL at all — the host typed an address; search for it.
    return embed(raw);
  }
  // A link with no place in it (maps.app.goo.gl / goo.gl short links):
  // searching for the URL text shows a world map, so search for the
  // venue's own name + address instead.
  const text = [venue?.name, venue?.address].map((s) => (s || "").trim()).filter(Boolean).join(", ");
  return text ? embed(text) : "";
}
const embedSrc = _toEmbedUrl((CONFIG.venue.mapsEmbedSrc || "").trim(), CONFIG.venue);
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
