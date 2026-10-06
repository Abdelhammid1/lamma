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
  _db = getFirestore(initializeApp(CONFIG.firebase, "sobou"));
}
export const db = _db;
