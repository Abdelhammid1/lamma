// Guestbook — writes a wish via POST /api/invitations/<slug>/wishes
// (Flask-backed) and polls the same endpoint for live-ish updates.
// Keeps the wording quieter than the wedding template ("A wish for the
// couple" rather than "Sign the guestbook") to match this template's
// calmer tone.

import { CONFIG } from "../config.js";

const SLUG     = CONFIG.slug || "demo";
const POST_URL = `/api/invitations/${encodeURIComponent(SLUG)}/wishes`;
const LIST_URL = `/api/invitations/${encodeURIComponent(SLUG)}/wishes?limit=100`;
const POLL_MS  = 25000;

const form      = document.getElementById("guestbook-form");
const nameEl    = document.getElementById("gb-name");
const messageEl = document.getElementById("gb-message");
const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
const statusEl  = document.getElementById("gb-status");
const listEl    = document.getElementById("gb-list");

/* ----- submit ----- */
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name    = (nameEl?.value    || "").trim();
  const message = (messageEl?.value || "").trim();
  if (!name || !message) {
    if (statusEl) statusEl.textContent = "Please fill in both fields.";
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  if (statusEl)  statusEl.textContent = "Sending…";
  try {
    const r = await fetch(POST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    form.reset();
    if (statusEl) statusEl.textContent = "Thank you — your wish is saved.";
    loadWishes();
  } catch (err) {
    console.error("[guestbook]", err);
    if (statusEl) statusEl.textContent = "Something went wrong. Try again.";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

/* ----- poll-based feed ----- */
// Guard against overlapping fetches so an earlier slow response can't
// overwrite a newer one with stale rows.
let gbInFlight = false;
let gbSeq = 0;
async function loadWishes() {
  if (!listEl || gbInFlight) return;
  gbInFlight = true;
  const myTicket = ++gbSeq;
  try {
    const r = await fetch(LIST_URL, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (myTicket !== gbSeq) return;
    listEl.innerHTML = "";
    for (const w of (j.wishes || [])) {
      const li = document.createElement("li");
      li.setAttribute("dir", "auto");

      const name = document.createElement("span");
      name.className = "gb-name";
      name.textContent = w.name || "A guest";

      const msg = document.createElement("span");
      msg.className = "gb-msg";
      msg.textContent = w.message || "";

      li.append(name, msg);
      listEl.appendChild(li);
    }
  } catch (err) {
    console.warn("[guestbook]", err);
  } finally {
    gbInFlight = false;
  }
}

if (listEl) {
  loadWishes();
  setInterval(() => { if (!document.hidden) loadWishes(); }, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadWishes(); });
}
