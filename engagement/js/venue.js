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

// Google refuses to iframe a /maps/place/* share URL (X-Frame-Options:
// SAMEORIGIN). Convert any non-embed URL into a working embed URL at
// render time so hosts who paste the regular share URL still get a map.
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
const embed = _toEmbedUrl((CONFIG.venue?.mapsEmbedSrc || "").trim(), CONFIG.venue);
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
