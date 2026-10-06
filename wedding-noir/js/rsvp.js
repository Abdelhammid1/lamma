// ============================================================================
//  RSVP form — writes a document to Firestore's `rsvps` collection.
//  If Firebase isn't configured (db === null), the form disables its submit
//  and shows a hint instead of throwing.
// ============================================================================

import { addDoc, collection, serverTimestamp } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, isConfigured } from "./firebase-init.js";
import { CONFIG } from "../config.js";

// Scoped per invitation: invitations/<slug>/rsvps
const SLUG = CONFIG.slug || "demo";
const COLLECTION = `invitations/${SLUG}/rsvps`;

const openBtn     = document.getElementById("rsvp-open");
const form        = document.getElementById("rsvp-form");
const nameInput   = document.getElementById("rsvp-name");
const guestsField = document.getElementById("guest-count-field");
const guestsInput = document.getElementById("rsvp-guests");
const statusEl    = document.getElementById("rsvp-status");
const submitBtn   = form ? form.querySelector('button[type="submit"]') : null;
const nameError   = document.querySelector('.error[data-for="rsvp-name"]');

/* ---------- Show / hide the form ---------- */
if (openBtn && form) {
  openBtn.addEventListener("click", () => {
    form.hidden = !form.hidden;
    openBtn.textContent = form.hidden ? "Confirm Attendance" : "Hide RSVP";
    if (!form.hidden) nameInput && nameInput.focus();
  });
}

/* ---------- Hide guest count when "not attending" ---------- */
function syncGuestField() {
  if (!form || !guestsField) return;
  const attending = form.attending.value === "yes";
  guestsField.hidden = !attending;
}
if (form) {
  form.querySelectorAll('input[name="attending"]').forEach((r) =>
    r.addEventListener("change", syncGuestField)
  );
  syncGuestField();
}

/* ---------- Disable form entirely when Firebase isn't configured ---------- */
if (!isConfigured() && form && submitBtn) {
  submitBtn.disabled = true;
  submitBtn.title = "Firebase not configured — see README";
  if (statusEl) {
    statusEl.textContent = "RSVP will be enabled once Firebase is configured (see README).";
    statusEl.className = "rsvp-status hint";
  }
}

/* ---------- Custom inline validation + submit ---------- */
function showNameError(msg) {
  if (nameError) nameError.textContent = msg;
  nameInput && nameInput.classList.toggle("invalid", Boolean(msg));
}

if (form) {
  form.setAttribute("novalidate", "");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isConfigured() || !db) return;

    const name = (nameInput.value || "").trim();
    if (!name) {
      showNameError("Please enter your name.");
      nameInput.focus();
      return;
    }
    showNameError("");

    const attending = form.attending.value === "yes";
    let guestCount  = 0;
    if (attending) {
      guestCount = parseInt(guestsInput.value, 10) || 1;
      if (guestCount < 1) guestCount = 1;
      if (guestCount > 10) guestCount = 10;
    }

    submitBtn.disabled = true;
    if (statusEl) {
      statusEl.textContent = "Sending…";
      statusEl.className   = "rsvp-status pending";
    }

    try {
      await addDoc(collection(db, COLLECTION), {
        name,
        attending,
        guestCount,
        createdAt: serverTimestamp(),
      });
      if (statusEl) {
        statusEl.textContent = attending
          ? "Thank you! Your RSVP has been received — we can't wait to see you."
          : "Thank you for letting us know. You'll be missed.";
        statusEl.className = "rsvp-status success";
      }
      form.reset();
      syncGuestField();
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.textContent = "Something went wrong sending your RSVP. Please try again.";
        statusEl.className = "rsvp-status error";
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Clear the inline error as the user types.
  nameInput && nameInput.addEventListener("input", () => showNameError(""));
}
