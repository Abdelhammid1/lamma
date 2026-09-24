// ============================================================================
//  Firebase bootstrap
//  Loads Firebase from CDN (ESM), initializes app + Firestore, and exports
//  the db handle for other modules. If config.js still contains PASTE_YOURS
//  placeholders, shows a top-of-page banner and exports db=null so other
//  modules can skip network calls cleanly.
// ============================================================================

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { CONFIG } from "../config.js";

/** True when the user hasn't pasted their real Firebase project config yet. */
export function isConfigured() {
  return Object.values(CONFIG.firebase).every(
    (v) => typeof v === "string" && v && v !== "PASTE_YOURS"
  );
}

function showConfigBanner() {
  const banner = document.createElement("div");
  banner.className = "config-banner";
  banner.innerHTML =
    "⚠️ Firebase is not configured yet. Paste your project config into " +
    "<code>config.js</code> — RSVP and Guestbook are disabled until then.";
  document.body.prepend(banner);
}

let _db = null;
if (isConfigured()) {
  const app = initializeApp(CONFIG.firebase);
  _db = getFirestore(app);
} else {
  // Run after DOMContentLoaded so document.body exists.
  if (document.body) showConfigBanner();
  else document.addEventListener("DOMContentLoaded", showConfigBanner);
}

export const db = _db;
