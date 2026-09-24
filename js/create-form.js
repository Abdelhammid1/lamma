// ============================================================================
//  Self-serve create flow:
//    - Type picker (birthday / wedding)
//    - Dynamic form (quiz + memories for birthday; venue/times for wedding)
//    - Live preview via postMessage → iframe
//    - Slug uniqueness check on Firestore
//    - Activation code gate (single-use, Firestore-verified)
//    - Publish flow: media → Firebase Storage → invitations doc + burn code
//
//  Publish is designed so a failure at any step leaves the code UNUSED
//  (we burn the code AFTER a successful invitation write, atomically
//  from the user's perspective — the doc rule enforces one-shot creation).
// ============================================================================

import { db, storage } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const $ = (id) => document.getElementById(id);

/* ================= State ================= */

const state = {
  type: "birthday",
  slugAvailable: null,        // null=unchecked, true, false
  codeChecked:   false,       // becomes true only right before publish
};

const MAX_MB      = 50;
const WARN_MB     = 25;
const MAX_TOTAL_MB = 300;

const RESERVED_SLUGS = new Set([
  "admin", "www", "api", "lamma", "mail", "ftp", "create", "wedding",
  "birthday", "invitation", "about", "contact", "terms", "privacy",
  "marsoud", "lexoffice", "almustashar", "activefit", "school",
  "elyasmin", "chatwoot", "n8n", "qaffer", "blog", "support", "help",
  "status",
]);

/* ================= Type toggle ================= */

document.querySelectorAll('input[name="event_type"]').forEach((r) =>
  r.addEventListener("change", () => {
    state.type = r.value;
    $("birthday-fields").hidden = state.type !== "birthday";
    $("wedding-fields").hidden  = state.type !== "wedding";
    // Reload the preview iframe with the right template
    const src = state.type === "wedding" ? "wedding/index.html?preview=1"
                                         : "birthday.html?preview=1";
    $("preview-frame").src = src;
    schedulePreview();
    updatePublishGate();
  })
);

/* ================= Slug helpers ================= */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

$("f-slug").addEventListener("input", debounce(async (e) => {
  const raw = (e.target.value || "").toLowerCase().trim();
  e.target.value = raw;
  $("slug-preview").textContent = raw ? `lamma.manasety.ai/${raw}` : "lamma.manasety.ai/<slug>";
  await checkSlug(raw);
  schedulePreview();
  updatePublishGate();
}, 400));

$("f-name").addEventListener("input", (e) => {
  const slugEl = $("f-slug");
  if (!slugEl.dataset.userEdited) {
    slugEl.value = slugify(e.target.value);
    slugEl.dispatchEvent(new Event("input", { bubbles: true }));
  }
  schedulePreview();
});
$("f-slug").addEventListener("keydown", () => { $("f-slug").dataset.userEdited = "1"; });

function slugify(s) {
  return (s || "").toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function checkSlug(slug) {
  const errEl = $("slug-error");
  state.slugAvailable = null;
  errEl.textContent = "";
  $("f-slug").classList.remove("invalid");

  if (!slug) return;
  if (!SLUG_RE.test(slug)) {
    errEl.textContent = "Use lowercase English letters, digits, or hyphens (2–40 chars).";
    $("f-slug").classList.add("invalid");
    return;
  }
  if (RESERVED_SLUGS.has(slug)) {
    errEl.textContent = "That name is reserved. Try another.";
    $("f-slug").classList.add("invalid");
    return;
  }
  try {
    const snap = await getDoc(doc(db, "invitations", slug));
    if (snap.exists()) {
      errEl.textContent = "That name is already taken.";
      $("f-slug").classList.add("invalid");
      state.slugAvailable = false;
    } else {
      state.slugAvailable = true;
    }
  } catch (e) {
    console.warn("[slug-check] Firestore lookup failed:", e);
    state.slugAvailable = true;   // don't block on network hiccup
  }
}

/* ================= Quiz builder ================= */

const quizBuilder = $("quiz-builder");
$("add-question-btn").addEventListener("click", () => {
  addQuizRow({ question: "", options: ["", "", ""], correctIndex: 0 });
  schedulePreview();
});

function addQuizRow(q) {
  const idx = quizBuilder.querySelectorAll(".q-row").length;
  const groupName = `q-correct-${Date.now()}-${idx}`;
  const row = document.createElement("div");
  row.className = "q-row";
  row.innerHTML = `
    <div class="q-row-header">
      <span class="q-num">Question ${idx + 1}</span>
      <button type="button" class="cx-btn cx-btn-ghost" data-remove-q>Remove</button>
    </div>
    <textarea class="q-text" placeholder="Your question…" dir="auto"></textarea>
    <div class="q-options">
      ${[0, 1, 2].map((i) => `
        <div class="q-option-row">
          <input type="radio" name="${groupName}" value="${i}" ${i === q.correctIndex ? "checked" : ""} title="Mark as correct">
          <input type="text" class="q-option-text" placeholder="Option ${i + 1}" dir="auto">
        </div>
      `).join("")}
    </div>
  `;
  row.querySelector(".q-text").value = q.question || "";
  const optInputs = row.querySelectorAll(".q-option-text");
  q.options.forEach((v, i) => { if (optInputs[i]) optInputs[i].value = v; });
  row.querySelector("[data-remove-q]").addEventListener("click", () => {
    row.remove(); renumberQuiz(); schedulePreview();
  });
  row.addEventListener("input", schedulePreview);
  row.addEventListener("change", schedulePreview);
  quizBuilder.appendChild(row);
  renumberQuiz();
}

function renumberQuiz() {
  quizBuilder.querySelectorAll(".q-row .q-num").forEach((el, i) => {
    el.textContent = `Question ${i + 1}`;
  });
}

function readQuiz() {
  return [...quizBuilder.querySelectorAll(".q-row")].map((row) => {
    const question = row.querySelector(".q-text").value.trim();
    const opts = [...row.querySelectorAll(".q-option-text")].map((i) => i.value.trim());
    const options = opts.filter(Boolean);
    const checked = [...row.querySelectorAll('input[type="radio"]')].findIndex((r) => r.checked);
    return { question, options, correctIndex: Math.max(0, checked) };
  }).filter((q) => q.question && q.options.length >= 2);
}

// Seed one row
addQuizRow({ question: "", options: ["", "", ""], correctIndex: 0 });

/* ================= Memories builder ================= */

const memBuilder = $("memories-builder");
$("add-memory-btn").addEventListener("click", () => { addMemoryRow(); schedulePreview(); });

function addMemoryRow() {
  const idx = memBuilder.querySelectorAll(".mem-row").length;
  const row = document.createElement("div");
  row.className = "mem-row";
  row.innerHTML = `
    <div class="mem-thumb"><div class="mem-thumb-num">#${idx + 1}</div></div>
    <div class="mem-fields">
      <div class="cx-field">
        <label>Photo</label>
        <input type="file" class="mem-file" accept="image/*">
      </div>
      <div class="cx-field">
        <label>Date caption (optional)</label>
        <input type="text" class="mem-date" placeholder="NOV 2024 · 23">
      </div>
    </div>
    <button type="button" class="mem-remove" title="Remove">×</button>
  `;
  const fileInput = row.querySelector(".mem-file");
  const thumb = row.querySelector(".mem-thumb");
  fileInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size / 1024 / 1024 > MAX_MB) {
      alert(`Photo too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_MB} MB.`);
      fileInput.value = "";
      return;
    }
    thumb.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
    schedulePreview();
  });
  row.querySelector(".mem-remove").addEventListener("click", () => {
    row.remove(); renumberMemories(); schedulePreview();
  });
  row.querySelector(".mem-date").addEventListener("input", schedulePreview);
  memBuilder.appendChild(row);
  renumberMemories();
}
function renumberMemories() {
  memBuilder.querySelectorAll(".mem-row .mem-thumb-num").forEach((el, i) => {
    el.textContent = `#${i + 1}`;
  });
}
addMemoryRow();  // seed one row

/* ================= Live preview ================= */

let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(sendPreview, 300);
}

function sendPreview() {
  const cfg = collectFormForPreview();
  const iframe = $("preview-frame");
  try {
    iframe.contentWindow.postMessage({ type: "lamma:preview", cfg }, "*");
  } catch (_) { /* ignore during navigation */ }
}

$("preview-frame").addEventListener("load", () => setTimeout(sendPreview, 100));

// Push preview on any form change
document.getElementById("editor-screen").addEventListener("input", schedulePreview);
document.getElementById("editor-screen").addEventListener("change", schedulePreview);

$("preview-open").addEventListener("click", () => {
  const cfg = collectFormForPreview();
  const payload = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))));
  const path = state.type === "wedding" ? "wedding/index.html" : "birthday.html";
  window.open(`${path}?preview=1&data=${payload}`, "_blank");
});

/* ================= Collect + validate ================= */

function collectFormForPreview() {
  const name = $("f-name").value.trim();
  if (state.type === "birthday") {
    return {
      slug:        $("f-slug").value,
      event_type:  "birthday",
      name,
      quiz:        readQuiz(),
      memories:    [...memBuilder.querySelectorAll(".mem-row")].map((row, i) => {
        const file = row.querySelector(".mem-file").files?.[0];
        return {
          url:       file ? URL.createObjectURL(file) : "",
          dateLabel: row.querySelector(".mem-date").value.trim(),
        };
      }),
      letterAr:    $("f-letterAr").value,
      letterEn:    $("f-letterEn").value,
      signatureEn: $("f-signatureEn").value,
      signatureAr: $("f-signatureAr").value,
      videoUrl:    $("f-video-url").value.trim(),
    };
  }
  // wedding
  const groom = $("f-groom").value.trim();
  const bride = $("f-bride").value.trim();
  return {
    slug:        $("f-slug").value,
    event_type:  "wedding",
    couple: { groom, bride, eventType: "Wedding",
              groomLabel: "The Groom", brideLabel: "The Bride" },
    event: {
      datetimeIso:   $("f-event-datetime").value ? new Date($("f-event-datetime").value).toISOString() : "",
      welcomeTime:   $("f-welcome-time").value,
      receptionTime: $("f-reception-time").value,
      durationHours: 4,
    },
    venue: {
      name:         $("f-venue-name").value,
      address:      $("f-venue-address").value,
      mapsEmbedSrc: $("f-venue-maps").value,
      mapsDeepLink: $("f-venue-maps").value,
    },
    blessing:  $("f-blessing").value,
    dressCode: { label: $("f-dress-code").value,
                 colors: ["#f7d9e1", "#efc8d2", "#a13b58", "#c9a86a"] },
    gallery:   [],
    music:     "",
  };
}

/* ================= Publish gate ================= */

const codeInput = $("f-code");
codeInput.addEventListener("input", updatePublishGate);
$("f-name").addEventListener("input", updatePublishGate);

function updatePublishGate() {
  const nameOk = !!$("f-name").value.trim();
  const slugOk = state.slugAvailable === true;
  const codeOk = codeInput.value.trim().length >= 6;
  const canPublish = nameOk && slugOk && codeOk;
  $("publish-btn").disabled = !canPublish;
  $("publish-hint").hidden  = canPublish;
  if (!canPublish) {
    const bits = [];
    if (!nameOk) bits.push("name");
    if (state.slugAvailable !== true) bits.push("valid available slug");
    if (!codeOk) bits.push("activation code");
    $("publish-hint").textContent = "Fill in: " + bits.join(", ") + ".";
  }
}

/* ================= Publish flow ================= */

$("publish-btn").addEventListener("click", publish);

function setProgress(pct, msg) {
  $("publish-progress").hidden = false;
  $("progress-fill").style.width = Math.max(2, pct) + "%";
  $("progress-text").textContent = msg;
}
function hideProgress() { $("publish-progress").hidden = true; }
function showCodeErr(msg) { $("code-error").textContent = msg; codeInput.classList.add("invalid"); }
function clearCodeErr()   { $("code-error").textContent = "";  codeInput.classList.remove("invalid"); }

function normalizeCode(raw) {
  const s = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 12 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}` : s;
}

async function publish() {
  clearCodeErr();
  const btn = $("publish-btn");
  btn.disabled = true;

  const slug = $("f-slug").value.trim();
  const code = normalizeCode(codeInput.value);

  try {
    // 1. Re-check slug (race safety)
    setProgress(5, "Checking your name…");
    const existing = await getDoc(doc(db, "invitations", slug));
    if (existing.exists()) {
      $("slug-error").textContent = "That name was just taken. Pick another.";
      $("f-slug").classList.add("invalid");
      throw new Error("slug taken");
    }

    // 2. Verify code up-front (fail fast, don't upload media yet)
    setProgress(10, "Checking your activation code…");
    const codeRef  = doc(db, "activation_codes", code);
    const codeSnap = await getDoc(codeRef);
    if (!codeSnap.exists()) {
      showCodeErr("This code doesn't exist. Double-check with the admin.");
      throw new Error("code not found");
    }
    const codeData = codeSnap.data();
    if (codeData.used) {
      showCodeErr("This code has already been used.");
      throw new Error("code used");
    }
    if (codeData.event_id && codeData.event_id !== slug) {
      showCodeErr("This code is bound to a different name.");
      throw new Error("code wrong event");
    }
    if (codeData.expires_at && codeData.expires_at.toDate && codeData.expires_at.toDate() < new Date()) {
      showCodeErr("This code has expired.");
      throw new Error("code expired");
    }

    // 3. Collect final config + upload media
    const cfg = collectFinalConfig();
    const files = collectFiles();
    let done = 0;
    const total = files.length + 2;                    // media + doc + code

    for (const f of files) {
      done++;
      setProgress((done / total) * 100, `Uploading photo ${done}/${files.length}…`);
      const path = `invitations/${slug}/${Date.now()}-${f.field}-${safeName(f.file.name)}`;
      const uploadRef = ref(storage, path);
      await uploadBytes(uploadRef, f.file, { contentType: f.file.type });
      const url = await getDownloadURL(uploadRef);
      f.assign(cfg, url);
    }

    // 4. Write invitation doc — the rule enforces one-shot creation
    setProgress(((done + 1) / total) * 100, "Saving your invitation…");
    cfg.slug         = slug;
    cfg.created_at   = serverTimestamp();
    cfg.published_at = serverTimestamp();
    await setDoc(doc(db, "invitations", slug), cfg);

    // 5. Burn the code
    setProgress(((done + 2) / total) * 100, "Locking in…");
    await updateDoc(codeRef, { used: true, used_at: serverTimestamp(), used_slug: slug });

    // 6. Success
    const url = `${location.origin}/${slug}`;
    $("success-url").href = url;
    $("success-url").textContent = url;
    $("editor-screen").hidden = true;
    $("success-screen").hidden = false;
    hideProgress();

  } catch (err) {
    console.error("[publish]", err);
    if (!$("code-error").textContent && !$("slug-error").textContent) {
      alert("Publish failed: " + (err.message || err) +
            "\n\nYour code is still valid — please retry.");
    }
    hideProgress();
    btn.disabled = false;
  }
}

function safeName(n) {
  return (n || "file").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "file";
}

/** Collect files that need uploading, with an "assign" callback that
 *  writes the resulting Firebase Storage URL back into the config. */
function collectFiles() {
  const files = [];
  if (state.type === "birthday") {
    memBuilder.querySelectorAll(".mem-row").forEach((row, i) => {
      const f = row.querySelector(".mem-file").files?.[0];
      if (f) {
        files.push({
          file: f,
          field: `photo-${i + 1}`,
          assign: (cfg, url) => { cfg.memories[i].url = url; delete cfg.memories[i]._file; },
        });
      }
    });
  }
  // wedding gallery TBD in Stage E follow-up (form has no wedding photo inputs yet)
  return files;
}

function collectFinalConfig() {
  // Same shape the templates already understand.
  return collectFormForPreview();
}

/* ================= Copy link ================= */

$("copy-url-btn").addEventListener("click", async () => {
  const url = $("success-url").textContent;
  try {
    await navigator.clipboard.writeText(url);
    $("copy-url-btn").textContent = "Copied ✓";
    setTimeout(() => { $("copy-url-btn").textContent = "Copy link"; }, 1500);
  } catch (_) { /* ignore */ }
});

/* ================= util ================= */

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
