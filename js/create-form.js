// ============================================================================
//  Self-serve create flow:
//    - Type picker (birthday / wedding)
//    - Dynamic form (quiz + memories for birthday; venue/times for wedding)
//    - Live preview via postMessage → iframe
//    - Slug uniqueness check via backend /api/check-slug
//    - Activation code gate (single-use, verified by backend at activate time)
//    - Publish flow: POST /api/events → POST /api/events/<id>/media (per file)
//      → POST /api/events/<id>/activate. The backend commits everything to
//      GitHub with a server-side PAT; the browser never sees a token.
//
//  Requires the Flask backend from lamma-backend/ deployed behind /api on
//  the same host (see lamma-backend/deploy/nginx.conf.sample). Without it,
//  the slug check falls open and Publish surfaces the network error.
// ============================================================================

import { CONFIG } from "../config.js";
import { RESERVED_SLUGS } from "./reserved-slugs.js";

const $ = (id) => document.getElementById(id);

/* ================= State ================= */

const state = {
  type: "birthday",
  slugAvailable: null,        // null=unchecked, true, false
  codeChecked:   false,       // becomes true only right before publish
};

/* ================= Admin mode detection =================
   When the admin opens /create via one of the links in the admin
   dashboard, two URL params change behavior:

     ?admin_create=1     Admin is creating a fresh invitation. The
                         activation-code gate is suppressed, Publish
                         commits directly via /admin/api/.../publish
                         (which Flask-Login's session cookie protects).

     ?admin_edit=<id>    Admin is editing an existing event. The
                         form is pre-filled from GET /admin/api/events/<id>,
                         slug/type become read-only, and the Publish
                         button becomes "Save changes" that PATCHes
                         the payload. */
const ADMIN_PARAMS = new URLSearchParams(location.search);
const ADMIN_MODE   =
    ADMIN_PARAMS.get("admin_edit")   ? "edit"
  : ADMIN_PARAMS.get("admin_create") ? "create"
  : null;
const ADMIN_EDIT_ID = ADMIN_PARAMS.get("admin_edit") || null;

const MAX_MB       = 35;    // per video / photo — real GitHub blob API ceiling
const WARN_MB      = 25;
const MAX_TOTAL_MB = 300;
const MAX_AUDIO_MB = 20;

function guardFileSize(input, maxMb, label) {
  const f = input.files?.[0];
  if (!f) return null;
  const mb = f.size / 1024 / 1024;
  if (mb > maxMb) {
    alert(`${label} too large (${mb.toFixed(1)} MB). Max ${maxMb} MB.`);
    input.value = "";
    return null;
  }
  return f;
}

// RESERVED_SLUGS imported from ./reserved-slugs.js

/* ================= Type toggle ================= */

function applyType(t) {
  if (t !== "birthday" && t !== "wedding") return;
  state.type = t;
  document.querySelectorAll('input[name="event_type"]').forEach((r) => {
    r.checked = (r.value === t);
  });
  $("birthday-fields").hidden = t !== "birthday";
  $("wedding-fields").hidden  = t !== "wedding";
  const title = $("cx-title");
  if (title) {
    title.textContent = t === "wedding" ? "Create your wedding invitation"
                                        : "Create your birthday invitation";
  }
  const src = t === "wedding" ? "wedding/index.html?preview=1"
                              : "birthday.html?preview=1";
  $("preview-frame").src = src;
  schedulePreview();
  updatePublishGate();
}

document.querySelectorAll('input[name="event_type"]').forEach((r) =>
  r.addEventListener("change", () => applyType(r.value))
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
    const r = await apiJson("POST", "/api/check-slug", { slug });
    if (r.available) {
      state.slugAvailable = true;
    } else {
      errEl.textContent = r.message || "That name is already taken.";
      $("f-slug").classList.add("invalid");
      state.slugAvailable = false;
    }
  } catch (e) {
    // Backend unreachable — don't block the button, but the eventual
    // POST /api/events will surface the real error at publish time.
    console.warn("[slug-check] backend unreachable:", e);
    state.slugAvailable = true;
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
        <button type="button" class="cx-btn cx-btn-ghost cx-clear mem-clear" hidden>Remove photo</button>
      </div>
      <div class="cx-field">
        <label>Date caption (optional)</label>
        <input type="text" class="mem-date" placeholder="NOV 2024 · 23">
      </div>
    </div>
    <button type="button" class="mem-remove" title="Remove entire row">×</button>
  `;
  const fileInput = row.querySelector(".mem-file");
  const thumb     = row.querySelector(".mem-thumb");
  const clearBtn  = row.querySelector(".mem-clear");
  const resetThumb = () => {
    thumb.innerHTML = `<div class="mem-thumb-num">#${idx + 1}</div>`;
    renumberMemories();
  };
  fileInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) { clearBtn.hidden = true; resetThumb(); schedulePreview(); return; }
    if (f.size / 1024 / 1024 > MAX_MB) {
      alert(`Photo too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_MB} MB.`);
      fileInput.value = "";
      clearBtn.hidden = true;
      return;
    }
    thumb.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
    clearBtn.hidden = false;
    schedulePreview();
  });
  clearBtn.addEventListener("click", () => {
    fileInput.value = "";
    clearBtn.hidden = true;
    resetThumb();
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

/* ================= Birthday video + music guards ================= */

$("f-video-file").addEventListener("change", (e) => {
  if (guardFileSize(e.target, MAX_MB, "Video")) schedulePreview();
  syncClearButton(e.target);
});
$("f-music-file").addEventListener("change", (e) => {
  if (guardFileSize(e.target, MAX_AUDIO_MB, "Audio")) schedulePreview();
  syncClearButton(e.target);
});

/* ================= Shared "Remove" (clear file input) wiring ================= */

// Every input with a sibling [data-clear="<input-id>"] button is wired
// up here: button shows while a file is selected, hides when cleared,
// click resets the input and re-runs the preview.
function syncClearButton(input) {
  const btn = document.querySelector(`[data-clear="${input.id}"]`);
  if (btn) btn.hidden = !(input.files && input.files.length);
}
document.querySelectorAll("[data-clear]").forEach((btn) => {
  const input = document.getElementById(btn.dataset.clear);
  if (!input) return;
  btn.addEventListener("click", () => {
    input.value = "";
    btn.hidden = true;
    schedulePreview();
  });
});

/* ================= Wedding gallery builder ================= */

const galleryBuilder = $("gallery-builder");
$("add-gallery-btn").addEventListener("click", () => { addGalleryRow(); schedulePreview(); });

function addGalleryRow() {
  const rows = galleryBuilder.querySelectorAll(".mem-row").length;
  if (rows >= 8) { alert("Up to 8 gallery photos."); return; }
  const row = document.createElement("div");
  row.className = "mem-row";
  row.innerHTML = `
    <div class="mem-thumb"><div class="mem-thumb-num">#${rows + 1}</div></div>
    <div class="mem-fields">
      <div class="cx-field">
        <label>Photo${rows === 0 ? " (hero)" : ""}</label>
        <input type="file" class="mem-file" accept="image/*">
        <button type="button" class="cx-btn cx-btn-ghost cx-clear mem-clear" hidden>Remove photo</button>
      </div>
    </div>
    <button type="button" class="mem-remove" title="Remove entire row">×</button>
  `;
  const fileInput = row.querySelector(".mem-file");
  const thumb     = row.querySelector(".mem-thumb");
  const clearBtn  = row.querySelector(".mem-clear");
  const resetThumb = () => {
    const num = [...galleryBuilder.querySelectorAll(".mem-row")].indexOf(row) + 1;
    thumb.innerHTML = `<div class="mem-thumb-num">#${num}</div>`;
  };
  fileInput.addEventListener("change", (e) => {
    const f = guardFileSize(e.target, MAX_MB, "Photo");
    if (!f) { clearBtn.hidden = true; resetThumb(); schedulePreview(); return; }
    thumb.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
    clearBtn.hidden = false;
    schedulePreview();
  });
  clearBtn.addEventListener("click", () => {
    fileInput.value = "";
    clearBtn.hidden = true;
    resetThumb();
    schedulePreview();
  });
  row.querySelector(".mem-remove").addEventListener("click", () => {
    row.remove();
    galleryBuilder.querySelectorAll(".mem-row .mem-thumb-num").forEach((el, i) => {
      el.textContent = `#${i + 1}`;
    });
    schedulePreview();
  });
  galleryBuilder.appendChild(row);
}

$("f-wedding-music").addEventListener("change", (e) => {
  if (guardFileSize(e.target, MAX_AUDIO_MB, "Audio")) schedulePreview();
  syncClearButton(e.target);
});

addGalleryRow();

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
    const videoFile = $("f-video-file").files?.[0];
    const musicFile = $("f-music-file").files?.[0];
    return {
      slug:        $("f-slug").value,
      event_type:  "birthday",
      name,
      quiz:        readQuiz(),
      memories:    [...memBuilder.querySelectorAll(".mem-row")].map((row) => {
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
      videoUrl:    videoFile ? URL.createObjectURL(videoFile) : $("f-video-url").value.trim(),
      musicUrl:    musicFile ? URL.createObjectURL(musicFile) : "",
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
    gallery:   [...galleryBuilder.querySelectorAll(".mem-row")].map((row) => {
      const file = row.querySelector(".mem-file").files?.[0];
      return file ? URL.createObjectURL(file) : "";
    }).filter(Boolean),
    music:     (() => {
      const f = $("f-wedding-music").files?.[0];
      return f ? URL.createObjectURL(f) : "";
    })(),
  };
}

/* ================= Publish gate ================= */

const codeInput = $("f-code");
codeInput.addEventListener("input", updatePublishGate);
$("f-name").addEventListener("input", updatePublishGate);

function updatePublishGate() {
  const nameOk = !!$("f-name").value.trim();
  // In edit mode the slug is immutable, so slugAvailable stays null —
  // treat it as satisfied. Admin create still enforces slug uniqueness.
  const slugOk = ADMIN_MODE === "edit"
    ? !!$("f-slug").value.trim()
    : state.slugAvailable === true;
  // Admin modes don't require an activation code — Flask-Login's
  // session cookie is the auth.
  const codeOk = ADMIN_MODE ? true : codeInput.value.trim().length >= 6;
  const canPublish = nameOk && slugOk && codeOk;
  $("publish-btn").disabled = !canPublish;
  $("publish-hint").hidden  = canPublish;
  if (!canPublish) {
    const bits = [];
    if (!nameOk) bits.push("name");
    if (!slugOk) bits.push("valid available slug");
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
  // Edit mode is a totally different animal (text PATCH only, no new
  // uploads or activate step). Hand off to the dedicated path.
  if (ADMIN_MODE === "edit") { return publishAdminEdit(); }

  clearCodeErr();
  const btn = $("publish-btn");
  btn.disabled = true;

  const slug = $("f-slug").value.trim();
  const code = normalizeCode(codeInput.value);
  const type = state.type;

  try {
    // 1. Rename each staged File so the backend commits it at a
    //    predictable path (`<type>/media/<slug>/<name>`) and the payload
    //    we send in step 2 can reference that URL directly.
    const files = prepareFiles(slug, type);
    const finalCfg = buildFinalConfig(files, slug, type);

    // 2. Create the event with the finalized payload. The backend
    //    reserves the slug in its DB here (unique constraint) — this is
    //    what supersedes the old Firestore slug-lock.
    setProgress(5, "Reserving your name…");
    const evt = await apiJson("POST", "/api/events", {
      slug,
      event_type: type,
      payload_json: finalCfg,
    });
    const eventId = evt.event_id;

    // 3. Upload each file via multipart POST. XHR gives real byte-
    //    progress; a genuine mobile stall now shows the exact byte
    //    count instead of hiding behind a static "Uploading photo…".
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const label = f.field.startsWith("photo") || f.field.startsWith("gallery")
        ? "photo" : f.field;
      const mbTotal = (f.file.size / 1024 / 1024).toFixed(1);
      const base    = 10 + (i / (files.length + 1)) * 80;
      const slice   = (1 / (files.length + 1)) * 80;
      setProgress(base, `Uploading ${label} ${i + 1}/${files.length} — 0.0 / ${mbTotal} MB`);
      await uploadFileWithProgress(
        `/api/events/${eventId}/media`,
        f.uploadFile,
        (bytesSent) => {
          const pct    = f.file.size ? bytesSent / f.file.size : 0;
          const mbSent = (bytesSent / 1024 / 1024).toFixed(1);
          setProgress(
            base + pct * slice,
            `Uploading ${label} ${i + 1}/${files.length} — ${mbSent} / ${mbTotal} MB`
          );
        }
      );
    }

    // 4. Activate — commits every staged blob + the data JSON. For a
    //    customer flow this verifies the activation code and burns it.
    //    For admin create (Flask-Login session already proves identity)
    //    the dedicated /admin/api/.../publish endpoint skips both.
    setProgress(95, "Publishing your invitation…");
    const act = ADMIN_MODE === "create"
      ? await apiJson("POST", `/admin/api/events/${eventId}/publish`, {})
      : await apiJson("POST", `/api/events/${eventId}/activate`, { code });

    // 5. Success — backend returns the real public URL.
    // Fallback mirrors the backend's _build_public_url: wedding lives
    // under /wedding/<slug>; birthday + anything else at /<slug>.
    const slugPath = type === "wedding" ? `/wedding/${slug}` : `/${slug}`;
    const publicUrl = act.public_url || `${location.origin}${slugPath}`;
    $("success-url").href = publicUrl;
    $("success-url").textContent = publicUrl;
    $("editor-screen").hidden = true;
    $("success-screen").hidden = false;
    hideProgress();

  } catch (err) {
    console.error("[publish]", err);
    const msg    = err?.data?.message || err.message || String(err);
    const reason = err?.data?.reason || err?.data?.error;
    if (reason === "used" || reason === "expired" ||
        reason === "wrong_event" || reason === "missing_code" ||
        reason === "not_found") {
      showCodeErr(msg);
    } else if (reason === "taken") {
      $("slug-error").textContent = msg;
      $("f-slug").classList.add("invalid");
    } else if (!$("code-error").textContent && !$("slug-error").textContent) {
      alert(
        "Publish failed: " + msg +
        "\n\nYour code is still valid — please retry."
      );
    }
    hideProgress();
    btn.disabled = false;
  }
}

/* ================= Backend API helpers ================= */

// Same-origin — nginx proxies /api/ to the Flask backend
// (see lamma-backend/deploy/nginx.conf.sample). If the backend isn't
// running, these calls surface a network error at publish time.
async function apiJson(method, path, body) {
  const res  = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body:    body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON body */ }
  if (!res.ok) {
    const err  = new Error(data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data   = data;
    throw err;
  }
  return data;
}

// Multipart file POST via XHR so `upload.onprogress` gives real bytes-
// transferred numbers. `fetch` doesn't expose upload progress.
function uploadFileWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      let body = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      const err  = new Error(body?.message || `HTTP ${xhr.status}`);
      err.status = xhr.status;
      err.data   = body;
      reject(err);
    };
    xhr.onerror = () => reject(new Error("Network error uploading file."));
    const fd = new FormData();
    fd.append("file", file, file.name);
    xhr.send(fd);
  });
}

// Mirrors lamma-backend/uploads.py:safe_filename so the URL we bake
// into the payload matches the filename the backend commits to GitHub.
function safeFilename(raw) {
  if (!raw) return "file";
  const base    = String(raw).split(/[\\/]/).pop();
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  return cleaned || "file";
}

/* ================= File collection + payload assembly ================= */

// Rename each File up-front with a `<field>-` prefix, so two "IMG_0001.jpg"
// files from the phone camera roll don't collide in the backend's per-event
// staging dir (which would otherwise get a `-<hash8>` suffix we can't
// predict client-side).
function prepareFiles(slug, type) {
  const list = [];
  const seen = new Set();
  const unique = (base) => {
    let n = base, i = 2;
    while (seen.has(n)) {
      n = base.replace(/(\.[^.]+)?$/, `-${i}$1`);
      i++;
    }
    seen.add(n);
    return n;
  };
  const add = (file, field) => {
    const prefixed = safeFilename(`${field}-${file.name}`);
    const finalName = unique(prefixed);
    list.push({
      file,
      uploadFile: new File([file], finalName, { type: file.type }),
      field,
      finalName,
      cdnPath: `${type}/media/${slug}/${finalName}`,
    });
  };

  if (type === "birthday") {
    memBuilder.querySelectorAll(".mem-row").forEach((row, i) => {
      const f = row.querySelector(".mem-file").files?.[0];
      if (f) add(f, `photo-${i + 1}`);
    });
    const vFile = $("f-video-file").files?.[0];
    if (vFile) add(vFile, "video");
    const mFile = $("f-music-file").files?.[0];
    if (mFile) add(mFile, "music");
  } else {
    const rows = [...galleryBuilder.querySelectorAll(".mem-row")];
    rows
      .map((row) => row.querySelector(".mem-file").files?.[0])
      .filter(Boolean)
      .forEach((f, i) => add(f, `gallery-${i + 1}`));
    const wm = $("f-wedding-music").files?.[0];
    if (wm) add(wm, "music");
  }
  return list;
}

// Take the preview cfg (which references files by blob: URLs) and swap
// in the public URLs the backend will serve each file at.
//
// Media now lives on the backend's own disk (served by nginx at /media/)
// instead of GitHub, so the baked-in URL is `/media/<slug>/<filename>`.
// We use a relative path so the same JSON works from any host the
// backend is deployed under; the loader resolves it against location.origin.
function buildFinalConfig(files, slug, type) {
  const cfg = collectFormForPreview();
  const urlFor = (field) => {
    const hit = files.find((x) => x.field === field);
    return hit ? `/media/${slug}/${hit.finalName}` : "";
  };

  if (type === "birthday") {
    cfg.memories = (cfg.memories || []).map((m, i) => {
      const url = urlFor(`photo-${i + 1}`);
      return { url: url || "", dateLabel: m.dateLabel || "" };
    }).filter((m) => m.url);
    const videoUrl = urlFor("video");
    cfg.videoUrl = videoUrl || (cfg.videoUrl || "");
    cfg.musicUrl = urlFor("music") || "";
  } else {
    cfg.gallery = files
      .filter((f) => f.field.startsWith("gallery-"))
      .map((f) => `/media/${slug}/${f.finalName}`);
    cfg.music = urlFor("music") || "";
  }
  return cfg;
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

/* ================= Admin modes ================= */

// Show a visible mode banner + hide the activation-code gate so the
// admin UI doesn't look misleading.
function applyAdminChrome() {
  if (!ADMIN_MODE) return;
  const codeField = $("f-code")?.closest(".cx-field");
  if (codeField) codeField.hidden = true;
  if ($("publish-hint")) $("publish-hint").hidden = true;
  const title = $("cx-title");
  if (title) {
    title.textContent = ADMIN_MODE === "edit"
      ? "Edit invitation (admin)"
      : "Create invitation (admin)";
  }
  const lede = document.querySelector(".cx-lede");
  if (lede) {
    lede.textContent = ADMIN_MODE === "edit"
      ? "You're editing this invitation as an admin. Changes are saved immediately — no activation code needed."
      : "Admin create: publishes immediately without an activation code.";
  }
  if ($("publish-btn")) {
    $("publish-btn").textContent =
      ADMIN_MODE === "edit" ? "Save changes" : "Publish (admin)";
  }
}

/* Pre-fill form fields from an existing event's stored payload. Called
 * on boot when ?admin_edit=<id> is present. */
async function loadAdminEditFixtures() {
  if (ADMIN_MODE !== "edit" || !ADMIN_EDIT_ID) return;
  let evt;
  try {
    evt = await apiJson("GET", `/admin/api/events/${ADMIN_EDIT_ID}`, null);
  } catch (e) {
    alert("Couldn't load this invitation: " + (e?.data?.message || e.message));
    return;
  }
  applyType(evt.event_type === "wedding" ? "wedding" : "birthday");

  // Slug + type become read-only in edit mode (changing them would
  // orphan the on-disk /data/<slug>.json and /media/<slug>/* trees).
  const slugEl = $("f-slug");
  slugEl.value = evt.slug;
  slugEl.readOnly = true;
  document.querySelectorAll('input[name="event_type"]').forEach((r) => {
    r.disabled = true;
  });

  const p = evt.payload_json || {};
  const setIf = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };

  if (state.type === "birthday") {
    setIf("f-name",        p.name);
    setIf("f-letterAr",    p.letterAr);
    setIf("f-letterEn",    p.letterEn);
    setIf("f-signatureEn", p.signatureEn);
    setIf("f-signatureAr", p.signatureAr);
    setIf("f-video-url",   p.videoUrl);
    // Rebuild quiz rows from stored data.
    if (Array.isArray(p.quiz) && p.quiz.length) {
      quizBuilder.innerHTML = "";
      for (const q of p.quiz) addQuizRow(q);
    }
  } else {
    const c = p.couple || {};
    setIf("f-groom",         c.groom);
    setIf("f-name",          c.groom && c.bride ? `${c.groom} & ${c.bride}` : "");
    setIf("f-bride",         c.bride);
    const ev = p.event || {};
    if (ev.datetimeIso && $("f-event-datetime")) {
      // <input type="datetime-local"> wants YYYY-MM-DDTHH:MM (no tz).
      try {
        const d = new Date(ev.datetimeIso);
        const pad = (n) => String(n).padStart(2, "0");
        $("f-event-datetime").value =
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
          `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } catch (_) { /* leave blank */ }
    }
    setIf("f-welcome-time",   ev.welcomeTime);
    setIf("f-reception-time", ev.receptionTime);
    const v = p.venue || {};
    setIf("f-venue-name",    v.name);
    setIf("f-venue-address", v.address);
    setIf("f-venue-maps",    v.mapsEmbedSrc);
    setIf("f-blessing",      p.blessing);
    setIf("f-dress-code",    p.dressCode?.label);
  }

  schedulePreview();
  updatePublishGate();
}

/* Edit-mode "Save changes" handler — PATCHes the payload. Does NOT
 * handle new file uploads in this iteration (text edits only). */
async function publishAdminEdit() {
  const btn = $("publish-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    // Reuse the preview builder — it already produces the right shape
    // for both birthday and wedding, with the file-URL fields pointing
    // at the live /media/<slug>/… paths that were committed last time.
    const nextPayload = collectFormForPreview();
    setProgress(50, "Saving changes…");
    await apiJson("PATCH", `/admin/api/events/${ADMIN_EDIT_ID}`, {
      payload_json: nextPayload,
    });
    setProgress(100, "Saved.");
    setTimeout(() => { hideProgress(); btn.textContent = "Save changes"; btn.disabled = false; }, 600);
  } catch (err) {
    console.error("[admin-edit]", err);
    alert("Save failed: " + (err?.data?.message || err.message || String(err)));
    hideProgress();
    btn.textContent = "Save changes";
    btn.disabled = false;
  }
}

/* ================= boot (last: all `let` bindings are alive) ================= */

const initialType = new URLSearchParams(location.search).get("type");
applyType(initialType === "wedding" ? "wedding" : "birthday");

applyAdminChrome();
loadAdminEditFixtures();
