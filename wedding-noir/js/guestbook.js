// ============================================================================
//  Guestbook — real-time wishes via Firestore.
//    - Form: name + message, both required, custom inline errors (no
//      browser popups), submit writes to the `guestbook` collection
//    - List: onSnapshot listener → prepends any new wish for anyone with the
//      page open, no reload
//    - RTL/Arabic-safe: dir="auto" on inputs and list items
// ============================================================================

import {
  addDoc, collection, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, isConfigured } from "./firebase-init.js";
import { CONFIG } from "../config.js";

// Scoped per invitation: invitations/<slug>/guestbook — so each wedding
// has its own private wishes and none leak across paying customers.
const SLUG = CONFIG.slug || "demo";
const COLLECTION = `invitations/${SLUG}/guestbook`;

const form       = document.getElementById("gb-form");
const nameEl     = document.getElementById("gb-name");
const messageEl  = document.getElementById("gb-message");
const submitBtn  = form ? form.querySelector('button[type="submit"]') : null;
const statusEl   = document.getElementById("gb-status");
const listEl     = document.getElementById("gb-list");
const emptyEl    = document.getElementById("gb-empty");
const nameErr    = document.querySelector('.error[data-for="gb-name"]');
const messageErr = document.querySelector('.error[data-for="gb-message"]');

/* ------------------------ Inline validation helpers ------------------------ */
function showError(input, errSpan, msg) {
  if (errSpan) errSpan.textContent = msg;
  input && input.classList.toggle("invalid", Boolean(msg));
}
if (nameEl)    nameEl.addEventListener("input",    () => showError(nameEl,    nameErr,    ""));
if (messageEl) messageEl.addEventListener("input", () => showError(messageEl, messageErr, ""));

/* ------------------------ Disable when not configured ---------------------- */
if (!isConfigured() && form && submitBtn) {
  submitBtn.disabled = true;
  submitBtn.title    = "Firebase not configured — see README";
  if (statusEl) {
    statusEl.textContent = "Guestbook will be enabled once Firebase is configured (see README).";
    statusEl.className   = "rsvp-status hint";
  }
  if (emptyEl) emptyEl.textContent = "Wishes will appear here once Firebase is configured.";
}

/* ------------------------ Submit → addDoc ---------------------------------- */
if (form) {
  form.setAttribute("novalidate", "");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isConfigured() || !db) return;

    const name    = (nameEl.value    || "").trim();
    const message = (messageEl.value || "").trim();

    let ok = true;
    if (!name)    { showError(nameEl,    nameErr,    "Please enter your name."); ok = false; }
    if (!message) { showError(messageEl, messageErr, "Please write a wish.");    ok = false; }
    if (!ok) { (nameEl.value ? messageEl : nameEl).focus(); return; }

    submitBtn.disabled = true;
    if (statusEl) {
      statusEl.textContent = "Sending your wish…";
      statusEl.className   = "rsvp-status pending";
    }

    try {
      await addDoc(collection(db, COLLECTION), {
        name,
        message,
        createdAt: serverTimestamp(),
      });
      form.reset();
      if (statusEl) {
        statusEl.textContent = "Thank you, your wish has been saved 💌";
        statusEl.className   = "rsvp-status success";
      }
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.textContent = "Something went wrong. Please try again.";
        statusEl.className   = "rsvp-status error";
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ------------------------ Real-time list ----------------------------------- */
function relativeTime(then) {
  if (!then) return "just now";
  const s = Math.floor((Date.now() - then.getTime()) / 1000);
  if (s < 60)        return "just now";
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function renderEntries(entries) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (emptyEl) emptyEl.hidden = entries.length > 0;

  for (const e of entries) {
    const li = document.createElement("li");
    li.className = "wish";
    li.setAttribute("dir", "auto");

    const header = document.createElement("div");
    header.className = "wish-header";

    const name = document.createElement("span");
    name.className = "wish-name";
    name.setAttribute("dir", "auto");
    name.textContent = e.name;

    const when = document.createElement("span");
    when.className = "wish-when";
    when.textContent = relativeTime(e.createdAt);

    header.append(name, when);

    const body = document.createElement("p");
    body.className = "wish-body";
    body.setAttribute("dir", "auto");
    body.textContent = e.message;

    li.append(header, body);
    listEl.appendChild(li);
  }
}

if (isConfigured() && db && listEl) {
  const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
  onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || "",
          message: data.message || "",
          // serverTimestamp() may briefly be null right after a local write.
          createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null,
        };
      });
      renderEntries(entries);
    },
    (err) => {
      console.error(err);
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = "Could not load wishes right now.";
      }
    }
  );
}
