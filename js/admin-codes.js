// ============================================================================
//  Admin — Activation Codes tab
//
//  Firebase-Auth gated. The Firestore rule on activation_codes requires
//  request.auth != null for both create and delete, so an unauthed client
//  physically cannot mint a code even if it tries. The UI still hides the
//  generate + list until the admin signs in so nothing looks broken.
//
//  Sign-in uses Firebase Auth email/password. Create admin users in the
//  Firebase console → Authentication → Users (email/password provider).
// ============================================================================

import { db, auth } from "./firebase-init.js";
import {
  collection, doc, getDocs, query, orderBy,
  setDoc, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (id) => document.getElementById(id);

/* ================= Code generation ================= */

// Crockford-style base32 minus visually ambiguous chars (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode() {
  let raw = "";
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  for (const b of arr) raw += ALPHABET[b % ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/* ================= UI wiring ================= */

const openBtn        = $("codes-tab-btn");
const panel          = $("codes-panel");
const generateBtn    = $("gen-code-btn");
const slugField      = $("gen-code-slug");
const hoursField     = $("gen-code-hours");
const notesField     = $("gen-code-notes");
const listEl         = $("codes-list");
const errEl          = $("gen-code-error");
const outEl          = $("gen-code-output");

const signinCard     = $("codes-signin");
const signinBtn      = $("codes-signin-btn");
const signinErr      = $("codes-signin-error");
const emailInput     = $("codes-email");
const passwordInput  = $("codes-password");
const whoamiEl       = $("codes-whoami");
const signoutBtn     = $("codes-signout-btn");

function setAuthedUI(user) {
  const authed = !!user;
  if (signinCard) signinCard.hidden = authed;
  if (signoutBtn) signoutBtn.hidden = !authed;
  document.querySelectorAll('[data-codes-authed]').forEach((el) => {
    el.hidden = !authed;
  });
  if (whoamiEl) {
    whoamiEl.textContent = authed ? ` · signed in as ${user.email}` : "";
  }
}

// Watch auth state. Any tab open on this page reflects the same state.
onAuthStateChanged(auth, (user) => {
  setAuthedUI(user);
  if (user && !panel.hidden) refreshCodes();
});

if (signinBtn) {
  signinBtn.addEventListener("click", async () => {
    signinErr.textContent = "";
    const email = (emailInput.value || "").trim();
    const password = passwordInput.value || "";
    if (!email || !password) {
      signinErr.textContent = "Enter your admin email and password.";
      return;
    }
    signinBtn.disabled = true;
    signinBtn.textContent = "Signing in…";
    try {
      await signInWithEmailAndPassword(auth, email, password);
      passwordInput.value = "";
      // onAuthStateChanged flips the UI
    } catch (err) {
      console.error(err);
      const code = err && err.code;
      signinErr.textContent =
        code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found"
          ? "Email or password is wrong."
          : code === "auth/too-many-requests"
          ? "Too many attempts. Wait a minute and try again."
          : "Sign-in failed: " + (err.message || code || err);
    } finally {
      signinBtn.disabled = false;
      signinBtn.textContent = "Sign in";
    }
  });
}

if (signoutBtn) {
  signoutBtn.addEventListener("click", () => signOut(auth));
}

if (openBtn) {
  openBtn.addEventListener("click", async () => {
    const showing = !panel.hidden;
    document.querySelectorAll('[data-admin-panel]').forEach((el) => (el.hidden = true));
    panel.hidden = showing;
    if (!panel.hidden && auth.currentUser) await refreshCodes();
  });
}

if (generateBtn) {
  generateBtn.addEventListener("click", async () => {
    errEl.textContent = "";
    outEl.hidden = true;

    if (!auth.currentUser) {
      errEl.textContent = "You need to sign in first.";
      return;
    }

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
        created_by: auth.currentUser.email || auth.currentUser.uid,
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
      errEl.textContent =
        err && err.code === "permission-denied"
          ? "Firestore rejected the write. Publish the rules from RULES.md and try again."
          : "Could not create code: " + (err.message || err);
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
  if (!auth.currentUser) return;   // rules would reject anyway
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
          ${c.used ? ` · used ${usedAt} → <code>${c.used_slug || "?"}</code>` : ""}
          ${c.notes ? ` · ${c.notes}` : ""}
        </div>
      `;
      listEl.appendChild(li);
    });
  } catch (err) {
    listEl.innerHTML = `<li class="empty">Could not load codes: ${err.message}${
      err.code === "permission-denied" ? " (publish rules from RULES.md)" : ""
    }</li>`;
  }
}

function isExpired(c) {
  if (!c.expires_at?.toDate) return false;
  return c.expires_at.toDate() < new Date();
}
