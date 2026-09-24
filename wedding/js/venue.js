// ============================================================================
//  Venue section: name/address text, Google Maps embed iframe src, and the
//  "Open in Maps" deep link — all pulled from CONFIG.venue.
// ============================================================================

import { CONFIG } from "../config.js";

const nameEl    = document.getElementById("venue-name");
const addressEl = document.getElementById("venue-address");
const iframe    = document.getElementById("venue-iframe");
const openLink  = document.getElementById("venue-open");

if (nameEl)    nameEl.textContent    = CONFIG.venue.name;
if (addressEl) addressEl.textContent = CONFIG.venue.address;
if (iframe)    iframe.src            = CONFIG.venue.mapsEmbedSrc;
if (openLink)  openLink.href         = CONFIG.venue.mapsDeepLink;
