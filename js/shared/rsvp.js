// ============================================================================
//  RSVP form — POSTs to the Lamma backend (/api/invitations/<slug>/rsvp)
//  so the owning host can read responses back without us exposing PII in
//  Firestore. Guestbook wishes go through the backend too.
// ============================================================================
//
//  Shared by every template that uses this markup: each template's
//  js/rsvp.js passes its own CONFIG in. Edit here, not in the folders.

export function initRsvp(CONFIG) {

  const SLUG = CONFIG.slug || "demo";
  const ENDPOINT = `/api/invitations/${encodeURIComponent(SLUG)}/rsvp`;

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

  /* ---------- Custom inline validation + submit ---------- */
  function showNameError(msg) {
    if (nameError) nameError.textContent = msg;
    nameInput && nameInput.classList.toggle("invalid", Boolean(msg));
  }

  if (form) {
    form.setAttribute("novalidate", "");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = (nameInput.value || "").trim();
      if (!name) {
        showNameError("Please enter your name.");
        nameInput.focus();
        return;
      }
      showNameError("");

      const attendingBool = form.attending.value === "yes";
      let guestCount  = 1;
      if (attendingBool) {
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
        const r = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            attending: attendingBool ? "yes" : "no",
            guestCount,
          }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.message || `HTTP ${r.status}`);
        }
        if (statusEl) {
          statusEl.textContent = attendingBool
            ? "Thank you! Your RSVP has been received — we can't wait to see you."
            : "Thank you for letting us know. You'll be missed.";
          statusEl.className = "rsvp-status success";
        }
        form.reset();
        syncGuestField();
      } catch (err) {
        console.error(err);
        if (statusEl) {
          statusEl.textContent = (err && err.message) ? `Couldn't send your RSVP: ${err.message}` : "Something went wrong sending your RSVP. Please try again.";
          statusEl.className = "rsvp-status error";
        }
      } finally {
        submitBtn.disabled = false;
      }
    });

    // Clear the inline error as the user types.
    nameInput && nameInput.addEventListener("input", () => showNameError(""));
  }
}
