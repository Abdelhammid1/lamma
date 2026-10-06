// Guestbook — writes a wish to invitations/<slug>/guestbook and renders
// the live feed via onSnapshot. Keeps the wording quieter than the
// wedding template ("A wish for the couple" rather than "Sign the
// guestbook") to match this template's calmer tone.

import {
  addDoc, collection, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, isConfigured } from "./firebase-init.js";
import { CONFIG } from "../config.js";

const SLUG       = CONFIG.slug || "demo";
const COLLECTION = `invitations/${SLUG}/guestbook`;

const form      = document.getElementById("guestbook-form");
const nameEl    = document.getElementById("gb-name");
const messageEl = document.getElementById("gb-message");
const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
const statusEl  = document.getElementById("gb-status");
const listEl    = document.getElementById("gb-list");

// If Firebase isn't wired, hide the whole section rather than show a
// broken form.
if (!isConfigured() || !db) {
  const section = document.getElementById("guestbook");
  if (section) section.hidden = true;
}

/* ----- submit ----- */
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!db) return;
  const name    = (nameEl?.value    || "").trim();
  const message = (messageEl?.value || "").trim();
  if (!name || !message) {
    if (statusEl) statusEl.textContent = "Please fill in both fields.";
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  if (statusEl)  statusEl.textContent = "Sending…";
  try {
    await addDoc(collection(db, COLLECTION), {
      name, message, createdAt: serverTimestamp(),
    });
    form.reset();
    if (statusEl) statusEl.textContent = "Thank you — your wish is saved.";
  } catch (err) {
    console.error("[guestbook]", err);
    if (statusEl) statusEl.textContent = "Something went wrong. Try again.";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

/* ----- live feed ----- */
if (db && listEl) {
  const feed = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
  onSnapshot(feed, (snap) => {
    listEl.innerHTML = "";
    for (const doc of snap.docs) {
      const data = doc.data();
      const li = document.createElement("li");
      li.setAttribute("dir", "auto");

      const name = document.createElement("span");
      name.className = "gb-name";
      name.textContent = data.name || "A guest";

      const msg = document.createElement("span");
      msg.className = "gb-msg";
      msg.textContent = data.message || "";

      li.append(name, msg);
      listEl.appendChild(li);
    }
  }, (err) => {
    console.error("[guestbook]", err);
  });
}
