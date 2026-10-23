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

// Convert /maps/place/* share URLs to embed URLs (Google refuses to
// iframe share URLs). See wedding/js/venue.js for the full rationale.
const embed = toEmbedUrl((CONFIG.venue?.mapsEmbedSrc || "").trim(), CONFIG.venue);
if (iframe && embed) iframe.src = embed;
else if (mapWrap)    mapWrap.hidden = true;

const deepLink = (CONFIG.venue?.mapsDeepLink || "").trim();
if (openLink) {
  if (deepLink) openLink.href = deepLink;
  else openLink.hidden = true;
}
