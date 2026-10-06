// Firebase bootstrap. Shared project with the wedding template so a
// couple who already has guestbook rules in place can reuse them.
// Mirrors wedding/js/firebase-init.js so each template stays
// independent and can evolve its own schema if needed.

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { CONFIG } from "../config.js";

export function isConfigured() {
  return Object.values(CONFIG.firebase).every(
    (v) => typeof v === "string" && v && v !== "PASTE_YOURS"
  );
}

let _db = null;
if (isConfigured()) {
  const app = initializeApp(CONFIG.firebase, "engagement");
  _db = getFirestore(app);
}

export const db = _db;
