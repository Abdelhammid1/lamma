// ============================================================================
//  Firebase bootstrap for the LAMMA site.
//  Reuses the same project the wedding guestbook uses (weding-dc92e), so
//  invitations + activation codes + uploaded media all live in one place.
// ============================================================================

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { getAuth } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyC4r0MZyLlX5c7UdYZ1j1L90vzUmm2A3co",
  authDomain:        "weding-dc92e.firebaseapp.com",
  projectId:         "weding-dc92e",
  storageBucket:     "weding-dc92e.firebasestorage.app",
  messagingSenderId: "645238686194",
  appId:             "1:645238686194:web:c2caf0ebcb31c7cee36b6b",
  measurementId:     "G-99C93SS013",
};

const app = initializeApp(firebaseConfig);
export const db      = getFirestore(app);
export const storage = getStorage(app);
export const auth    = getAuth(app);
export { app };
