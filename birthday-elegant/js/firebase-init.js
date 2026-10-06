// ============================================================================
//  Firebase bootstrap for birthday-elegant.
//  Named app so initializing alongside the classic birthday template (both
//  share the same Firebase project) doesn't throw a duplicate-app error.
// ============================================================================

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { CONFIG } from "../config.js";

function isConfigured() {
  return Object.values(CONFIG.firebase).every(
    (v) => typeof v === "string" && v && v !== "PASTE_YOURS"
  );
}

let _db = null;
if (isConfigured()) {
  const app = initializeApp(CONFIG.firebase, "birthday-elegant");
  _db = getFirestore(app);
}

export const db = _db;
