// Guestbook — "دعوة بالخير" messages written to invitations/<slug>/
// guestbook and rendered live via onSnapshot. RTL-safe: every list
// item carries `dir="auto"` so a message pasted in Latin flips cleanly.

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

if (!isConfigured() || !db) {
  const section = document.getElementById("guestbook");
  if (section) section.hidden = true;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!db) return;
  const name    = (nameEl?.value    || "").trim();
  const message = (messageEl?.value || "").trim();
  if (!name || !message) {
    if (statusEl) statusEl.textContent = "من فضلك املأ الحقلين.";
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  if (statusEl)  statusEl.textContent = "جاري الإرسال…";
  try {
    await addDoc(collection(db, COLLECTION), {
      name, message, createdAt: serverTimestamp(),
    });
    form.reset();
    if (statusEl) statusEl.textContent = "جزاكم الله خيرًا — دعوتكم وصلت.";
  } catch (err) {
    console.error("[qiraya-guestbook]", err);
    if (statusEl) statusEl.textContent = "حصلت مشكلة. حاول مرة أخرى.";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

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
      name.textContent = data.name || "ضيف";

      const msg = document.createElement("span");
      msg.className = "gb-msg";
      msg.textContent = data.message || "";

      li.append(name, msg);
      listEl.appendChild(li);
    }
  }, (err) => console.error("[qiraya-guestbook]", err));
}
