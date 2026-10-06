// Firebase bootstrap — shared project with wedding/engagement so a
// family can see all their invitations' guestbooks in one Firestore.
// Each template gets its own named app instance.

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
  const app = initializeApp(CONFIG.firebase, "qiraya");
  _db = getFirestore(app);
}

export const db = _db;
