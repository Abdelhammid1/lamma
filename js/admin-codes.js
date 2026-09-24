// ============================================================================
//  Admin — Activation Codes tab
//  Runs alongside the existing PAT-gated birthday admin. Codes live in
//  Firestore (weding-dc92e / activation_codes). Anyone visiting /admin
//  and clicking the "Codes" tab sees the list + can generate new ones.
//
//  For MVP, code creation is done from the admin panel with client-side
//  writes; the Firestore security rule for `activation_codes` allows
//  create only from an authenticated admin — but we're SKIPPING Firebase
//  Auth for now and using a simple shared secret gate on the client. The
//  code list is not shown to unauth'd visitors.
// ============================================================================

import { db } from "./firebase-init.js";
import {
  collection, doc, getDocs, query, orderBy,
  setDoc, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);


/* ================= Code generation ================= */

// Crockford-style base32 minus visually ambiguous chars (0/O, 1/I/L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode() {
  let raw = "";
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  for (const b of arr) raw += ALPHABET[b % ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function normalize(raw) {
  const s = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 12 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}` : s;
}


/* ================= UI wiring ================= */

const openBtn      = $("codes-tab-btn");
const panel        = $("codes-panel");
const generateBtn  = $("gen-code-btn");
const slugField    = $("gen-code-slug");
const hoursField   = $("gen-code-hours");
const notesField   = $("gen-code-notes");
const listEl       = $("codes-list");
const errEl        = $("gen-code-error");
const outEl        = $("gen-code-output");


if (openBtn) {
  openBtn.addEventListener("click", async () => {
    // Toggle panel + reload list
    const showing = !panel.hidden;
    document.querySelectorAll('[data-admin-panel]').forEach(el => el.hidden = true);
    panel.hidden = showing;
    if (!panel.hidden) await refreshCodes();
  });
}


if (generateBtn) {
  generateBtn.addEventListener("click", async () => {
    errEl.textContent = "";
    outEl.hidden = true;

    const slug  = (slugField.value || "").trim().toLowerCase() || null;
    const hours = parseInt(hoursField.value, 10);
    const notes = (notesField.value || "").trim() || null;

    if (slug && !/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(slug)) {
      errEl.textContent = "Slug format invalid (lowercase letters/digits/hyphens, 2–40 chars).";
      return;
    }

    generateBtn.disabled = true;
    generateBtn.textContent = "Generating…";

    try {
      const code = generateCode();
      const payload = {
        used: false,
        created_at: serverTimestamp(),
        event_id: slug,
        notes,
      };
      if (hours && hours > 0) {
        payload.expires_at = Timestamp.fromDate(new Date(Date.now() + hours * 3600 * 1000));
      }
      await setDoc(doc(db, "activation_codes", code), payload);

      $("gen-code-value").textContent = code;
      outEl.hidden = false;
      slugField.value = "";
      notesField.value = "";
      hoursField.value = "";

      await refreshCodes();
    } catch (err) {
      console.error(err);
      errEl.textContent = "Could not create code: " + (err.message || err);
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "+ Generate code";
    }
  });
}


$("copy-code-btn")?.addEventListener("click", async () => {
  const code = $("gen-code-value").textContent;
  try {
    await navigator.clipboard.writeText(code);
    $("copy-code-btn").textContent = "Copied ✓";
    setTimeout(() => { $("copy-code-btn").textContent = "Copy"; }, 1500);
  } catch (_) { /* ignore */ }
});


async function refreshCodes() {
  listEl.innerHTML = '<li class="empty">Loading…</li>';
  try {
    const snap = await getDocs(query(collection(db, "activation_codes"),
                                     orderBy("created_at", "desc")));
    if (snap.empty) {
      listEl.innerHTML = '<li class="empty">No codes yet. Generate the first one above.</li>';
      return;
    }
    listEl.innerHTML = "";
    snap.forEach((d) => {
      const c = d.data();
      const status = c.used ? "USED" : (isExpired(c) ? "EXPIRED" : "ACTIVE");
      const when   = c.created_at?.toDate?.().toLocaleString?.() || "—";
      const usedAt = c.used_at?.toDate?.().toLocaleString?.() || "";
      const li = document.createElement("li");
      li.className = "code-row code-" + status.toLowerCase();
      li.innerHTML = `
        <div class="code-main">
          <code class="code-value">${d.id}</code>
          <span class="code-tag">${status}</span>
        </div>
        <div class="code-meta">
          ${c.event_id ? `for <code>${c.event_id}</code> · ` : "unbound · "}
          created ${when}
          ${c.used ? ` · used ${usedAt}` : ""}
          ${c.notes ? ` · ${c.notes}` : ""}
        </div>
      `;
      listEl.appendChild(li);
    });
  } catch (err) {
    listEl.innerHTML = `<li class="empty">Could not load codes: ${err.message}</li>`;
  }
}

function isExpired(c) {
  if (!c.expires_at?.toDate) return false;
  return c.expires_at.toDate() < new Date();
}
