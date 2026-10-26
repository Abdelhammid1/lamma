// ============================================================================
//  Self-serve create flow:
//    - Type picker (birthday / wedding)
//    - Dynamic form (quiz + memories for birthday; venue/times for wedding)
//    - Live preview via postMessage → iframe
//    - Slug uniqueness check via backend /api/check-slug
//    - Activation code gate (single-use, verified by backend at activate time)
//    - Publish flow: POST /api/events → POST /api/events/<id>/media (per file)
//      → POST /api/events/<id>/activate. The backend saves everything to the
//      server's own disk; the browser never sees a token.
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

const MAX_MB       = 300;    // per video / photo — matches uploads.py MAX_FILE_BYTES
const WARN_MB      = 250;
const MAX_TOTAL_MB = 1024;
const MAX_AUDIO_MB = 50;

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

// All templates that share the "couple + event + venue" schema reuse
// the wedding-shaped form. Birthday is the only outlier (quiz + memories).
const COUPLE_TYPES = new Set(["wedding", "wedding-noir", "wedding-burgundy", "wedding-wizard", "engagement", "qiraya", "sobou"]);
const BIRTHDAY_TYPES = new Set(["birthday", "birthday-elegant"]);
const ALL_TYPES    = new Set([...BIRTHDAY_TYPES, ...COUPLE_TYPES]);

const TYPE_TITLE = {
  birthday:          "Create your birthday invitation",
  "birthday-elegant":"Create your birthday invitation — Elegant",
  wedding:           "Create your wedding invitation",
  "wedding-noir":    "Create your wedding invitation — Noir",
  "wedding-burgundy": "Create your wedding invitation — Burgundy",
  "wedding-wizard":   "Create your wedding invitation — Wizard",
  engagement:        "Create your engagement invitation",
  qiraya:            "اعمل دعوة قراية فاتحة",
  sobou:             "اعمل دعوة سبوع",
};

const TYPE_PREVIEW = {
  birthday:           "birthday.html?preview=1",
  "birthday-elegant": "birthday-elegant/index.html?preview=1",
  wedding:            "wedding/index.html?preview=1",
  "wedding-noir":     "wedding-noir/index.html?preview=1",
  "wedding-burgundy": "wedding-burgundy/index.html?preview=1",
  "wedding-wizard":   "wedding-wizard/index.html?preview=1",
  engagement:         "engagement/index.html?preview=1",
  qiraya:             "qiraya/index.html?preview=1",
  sobou:              "sobou/index.html?preview=1",
};

function applyType(t) {
  if (!ALL_TYPES.has(t)) return;
  state.type = t;
  document.querySelectorAll('input[name="event_type"]').forEach((r) => {
    r.checked = (r.value === t);
  });
  // Reflect the active template on the pill row too.
  document.querySelectorAll("#type-pills .cx-pill").forEach((btn) => {
    const on = btn.dataset.type === t;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const usesCoupleForm = COUPLE_TYPES.has(t);
  $("birthday-fields").hidden = !!usesCoupleForm;
  $("wedding-fields").hidden  = !usesCoupleForm;
  // The elegant birthday variant has no quiz — hide that group so the
  // host isn't asked to fill questions that will never be shown.
  const quizGroup = $("quiz-group");
  if (quizGroup) quizGroup.hidden = (t === "birthday-elegant");
  // Only ask for what the chosen template actually shows: qiraya and
  // sobou have no gallery or dress-code section, and only the elegant
  // birthday has the two cover lines.
  const noGallery = (t === "qiraya" || t === "sobou");
  $("dress-group").hidden   = noGallery;
  $("gallery-group").hidden = noGallery || t === "wedding-wizard";   // the wizard has no gallery
  $("dress-note-field").hidden = (t !== "wedding-wizard");
  $("elegant-group").style.display = (t === "birthday-elegant") ? "" : "none";
  $("burgundy-group").hidden      = (t !== "wedding-burgundy");
  $("burgundy-gift-group").hidden = (t !== "wedding-burgundy");
  updateSlugLink();
  // سبوع isn't a couple — it's a baby's naming ceremony. The groom
  // field holds the baby's name, the bride field holds the family /
  // parents. Rewrite the labels so the host isn't confused into
  // typing nonsense into "Groom name" for their newborn.
  const groomLbl = $("f-groom-label");
  const brideLbl = $("f-bride-label");
  if (t === "sobou") {
    if (groomLbl) groomLbl.textContent = "Baby's name";
    if (brideLbl) brideLbl.textContent = "Family / parents";
  } else if (groomLbl && brideLbl) {
    groomLbl.textContent = "Groom name";
    brideLbl.textContent = "Bride name";
  }
  // The top "Name (or couple)" field is only read by birthday variants
  // (CONFIG.name) and by slugify() as the auto-slug seed. Couple
  // templates render from Groom + Bride instead, so showing the field
  // on top misleads hosts into typing the actual names there — which
  // the preview then ignores. Hide it for couple types and keep it
  // auto-synced from groom+bride so the slug + publish gate still work.
  // Use style.display (not .hidden) — .cx-field has display:flex which
  // overrides the [hidden] user-agent rule.
  const nameWrap = $("name-field-wrapper");
  if (nameWrap) nameWrap.style.display = usesCoupleForm ? "none" : "";
  if (usesCoupleForm) syncNameFromCouple();
  // Edit mode keeps its own heading (set by applyAdminChrome); loading
  // the event calls applyType and used to overwrite it with "Create…".
  const title = $("cx-title");
  if (title && ADMIN_MODE !== "edit") title.textContent = TYPE_TITLE[t];
  // Fresh frame for the new template; it pushes the form's data into
  // itself once loaded (the buffered swap in sendPreview takes over
  // from the next change on).
  lastPreviewUrl = "";
  const frame = $("preview-frame");
  frame.addEventListener("load", () => setTimeout(sendPreview, 100), { once: true });
  frame.src = TYPE_PREVIEW[t];
  schedulePreview();
  updatePublishGate();
}

document.querySelectorAll('input[name="event_type"]').forEach((r) =>
  r.addEventListener("change", () => applyType(r.value))
);

// Template-switcher pills — click to flip type without reloading. The
// pill row lives above the shared Name / Slug fields so switching from
// a wedding to a سبوع mid-session keeps whatever the host already typed.
// The URL query (?type=…) is also rewritten so a browser refresh
// restores the picked template.
document.querySelectorAll("#type-pills .cx-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    const t = btn.dataset.type;
    if (!ALL_TYPES.has(t) || t === state.type) return;
    applyType(t);
    try {
      const url = new URL(location.href);
      url.searchParams.set("type", t);
      history.replaceState(null, "", url.toString());
    } catch (_) { /* ignore */ }
  });
});

/* ================= Slug helpers ================= */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

$("f-slug").addEventListener("input", debounce(async (e) => {
  const raw = (e.target.value || "").toLowerCase().trim();
  e.target.value = raw;
  updateSlugLink();
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

// Keep the hidden-for-couples f-name in sync with the Groom + Bride
// fields so the slug auto-generation and the publish gate still have
// a non-empty value to work with. Dispatched as an input event so the
// slug input listener and updatePublishGate() pick it up.
function syncNameFromCouple() {
  const g = ($("f-groom").value || "").trim();
  const b = ($("f-bride").value || "").trim();
  const combined =
    state.type === "sobou"       ? g                 // سبوع: baby's name only
    : (g && b)                   ? `${g} & ${b}`      // Ahmed & Sara
    : (g || b || "");
  const nameEl = $("f-name");
  if (nameEl.value === combined) return;
  nameEl.value = combined;
  nameEl.dispatchEvent(new Event("input", { bubbles: true }));
}
$("f-groom").addEventListener("input", () => { if (COUPLE_TYPES.has(state.type)) syncNameFromCouple(); });
$("f-bride").addEventListener("input", () => { if (COUPLE_TYPES.has(state.type)) syncNameFromCouple(); });

// The address guests actually open: every template except the classic
// birthday lives under /<template>/ (mirrors _build_public_url).
function updateSlugLink() {
  const slug = ($("f-slug").value || "").trim();
  const prefix = state.type === "birthday" ? "" : `${state.type}/`;
  $("slug-preview").textContent = `lamma.manasety.ai/${prefix}${slug || "<slug>"}`;
}

function slugify(s) {
  const latin = (s || "").toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  if (latin.length >= 2) return latin;
  // Arabic names used to leave the address empty ("Fill in: valid
  // available slug"). Suggest a Latin spelling the host can edit.
  return transliterate(s).slice(0, 40).replace(/-+$/, "");
}

const AR_LATIN = {
  "ا": "a", "أ": "a", "إ": "e", "آ": "a", "ب": "b", "ت": "t", "ث": "th",
  "ج": "g", "ح": "h", "خ": "kh", "د": "d", "ذ": "z", "ر": "r", "ز": "z",
  "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a",
  "غ": "gh", "ف": "f", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n",
  "ه": "h", "ة": "a", "و": "o", "ؤ": "o", "ي": "y", "ى": "a", "ئ": "e",
  "ء": "", "&": "-and-",
};
function transliterate(s) {
  return [...(s || "")].map((ch) => (ch in AR_LATIN ? AR_LATIN[ch] : ch))
    .join("").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

function addMemoryRow(existing) {
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
  // In edit mode we pre-fill a row with the already-committed photo —
  // show its thumbnail + stash the URL on the row's dataset so
  // collectForm can keep it when the host doesn't pick a new file.
  // Date caption also pre-fills. The × button on the right removes the
  // whole row (and therefore drops this photo from the payload).
  // Picking a new file via the <input type="file"> replaces the
  // thumbnail — the dataset URL is cleared then so the new file wins.
  if (existing && existing.url) {
    // Assign .src via createElement (not an interpolated innerHTML
    // template literal) — the stored URL came from the host's own
    // published payload, so a crafted value like `" onerror="…`
    // interpolated into an src="…" attribute would break out and run
    // when another admin opens the event for editing.
    row.dataset.existingUrl = existing.url;
    const img = document.createElement("img");
    img.src = existing.url;
    img.alt = "";
    thumb.replaceChildren(img);
    if (existing.dateLabel) row.querySelector(".mem-date").value = existing.dateLabel;
  }
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
    // A new file replaces an existing cloud photo — drop the stashed
    // URL so collectForm picks the new upload instead.
    delete row.dataset.existingUrl;
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

function addGalleryRow(existingUrl) {
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
  // Edit mode seed — show the already-committed photo + stash its URL
  // so publish keeps it when the host doesn't pick a new file.
  // Assign .src via createElement (not interpolated innerHTML) — the
  // stored URL is host-controlled, so `" onerror="…` interpolated into
  // src="…" would run when another admin opens this event.
  if (existingUrl) {
    row.dataset.existingUrl = existingUrl;
    const img = document.createElement("img");
    img.src = existingUrl;
    img.alt = "";
    thumb.replaceChildren(img);
  }
  const resetThumb = () => {
    const num = [...galleryBuilder.querySelectorAll(".mem-row")].indexOf(row) + 1;
    thumb.innerHTML = `<div class="mem-thumb-num">#${num}</div>`;
  };
  fileInput.addEventListener("change", (e) => {
    const f = guardFileSize(e.target, MAX_MB, "Photo");
    if (!f) { clearBtn.hidden = true; resetThumb(); schedulePreview(); return; }
    delete row.dataset.existingUrl;
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

/* ================= Program / schedule builder ================= */

const scheduleBuilder = $("schedule-builder");
$("add-schedule-btn").addEventListener("click", () => { addScheduleRow(); schedulePreview(); });

/* ================= Contacts builder ================= */

const contactsBuilder = $("contacts-builder");
$("add-contact-btn").addEventListener("click", () => {
  if (contactsBuilder.querySelectorAll(".contact-row").length >= 4) {
    alert("Up to 4 contacts."); return;
  }
  addContactRow(); schedulePreview();
});

function addContactRow(existing) {
  const row = document.createElement("div");
  row.className = "contact-row";
  row.innerHTML = `
    <input type="text" class="c-name"  dir="auto" placeholder="Name (e.g. Mark Yasser)">
    <input type="text" class="c-role"  dir="auto" placeholder="Role (e.g. Groom Brother)">
    <input type="tel"  class="c-phone" dir="ltr"  placeholder="+20 10 1234 5678">
    <button type="button" class="c-remove" title="Remove" aria-label="Remove">×</button>
  `;
  const nameEl  = row.querySelector(".c-name");
  const roleEl  = row.querySelector(".c-role");
  const phoneEl = row.querySelector(".c-phone");
  if (existing && typeof existing === "object") {
    if (typeof existing.name  === "string") nameEl.value  = existing.name;
    if (typeof existing.role  === "string") roleEl.value  = existing.role;
    if (typeof existing.phone === "string") phoneEl.value = existing.phone;
  }
  row.querySelector(".c-remove").addEventListener("click", () => { row.remove(); schedulePreview(); });
  [nameEl, roleEl, phoneEl].forEach((el) => el.addEventListener("input", schedulePreview));
  contactsBuilder.appendChild(row);
}

function addScheduleRow(existing) {
  const row = document.createElement("div");
  row.className = "sched-row";
  row.innerHTML = `
    <input type="time" class="sched-time" aria-label="Time">
    <input type="text" class="sched-label" dir="auto" placeholder="e.g. Reception / الاستقبال">
    <button type="button" class="sched-remove" title="Remove item" aria-label="Remove">×</button>
  `;
  const timeEl  = row.querySelector(".sched-time");
  const labelEl = row.querySelector(".sched-label");
  if (existing && typeof existing === "object") {
    if (/^\d{1,2}:\d{2}$/.test(existing.time || "")) timeEl.value = existing.time;
    if (typeof existing.label === "string")          labelEl.value = existing.label;
  }
  row.querySelector(".sched-remove").addEventListener("click", () => {
    row.remove(); schedulePreview();
  });
  timeEl.addEventListener("input",  schedulePreview);
  labelEl.addEventListener("input", schedulePreview);
  scheduleBuilder.appendChild(row);
}

/* ================= Live preview ================= */

let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(sendPreview, 300);
}

// The classic birthday re-renders in place on a postMessage. The other
// templates can only render once per page load, so each change used to
// reload the visible iframe: a blank flash, and the scroll jumped back
// to the top every keystroke. Now the next version loads in a hidden
// iframe on top, and is swapped in at the same scroll position once it
// has rendered.
let previewSeq = 0;
let lastPreviewUrl = "";

function sendPreview() {
  const cfg = collectFormForPreview();
  const iframe = $("preview-frame");
  if (state.type === "birthday") {
    try {
      iframe.contentWindow.postMessage({ type: "lamma:preview", cfg }, location.origin);
    } catch (_) { /* ignore during navigation */ }
    return;
  }
  const url = `${TYPE_PREVIEW[state.type]}&data=${encodePreview(cfg)}`;
  if (url === lastPreviewUrl) return;
  lastPreviewUrl = url;
  const mine = ++previewSeq;
  document.querySelectorAll(".cx-preview-stage iframe.is-loading").forEach((f) => f.remove());
  const next = document.createElement("iframe");
  next.title = "Preview";
  next.className = "is-loading";
  next.addEventListener("load", async () => {
    await renderedOrTimeout(next, 1500);
    if (mine !== previewSeq) { next.remove(); return; }
    const cur = $("preview-frame");
    copyScroll(cur, next);
    cur.remove();
    next.classList.remove("is-loading");
    next.id = "preview-frame";
  }, { once: true });
  next.src = url;
  $("preview-frame").parentElement.appendChild(next);
}

function encodePreview(cfg) {
  return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))));
}

// Template bootstraps add body.opened once every renderer has run in
// preview mode; fall back to a timeout so a slow template still swaps.
function renderedOrTimeout(frame, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function poll() {
      let done = false;
      try { done = frame.contentDocument?.body?.classList.contains("opened"); } catch (_) {}
      if (done || Date.now() - t0 > ms) return resolve();
      setTimeout(poll, 50);
    })();
  });
}

// Some templates scroll the window, some scroll <body>; copy both.
function copyScroll(from, to) {
  try {
    const y  = from.contentWindow.scrollY;
    const by = from.contentDocument.body.scrollTop;
    to.contentWindow.scrollTo(0, y);
    to.contentDocument.body.scrollTop = by;
  } catch (_) { /* cross-document access failed — keep the top */ }
}


// Push preview on any form change
document.getElementById("editor-screen").addEventListener("input", schedulePreview);
document.getElementById("editor-screen").addEventListener("change", schedulePreview);

$("preview-open").addEventListener("click", () => {
  const cfg = collectFormForPreview();
  const payload = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))));
  // Each prefix-routed template serves its own index.html. The classic
  // birthday still lands on birthday.html at the root; every other
  // template (couple-shaped or birthday-elegant) is under its own folder.
  const path = state.type === "birthday"
    ? "birthday.html"
    : `${state.type}/index.html`;
  window.open(`${path}?preview=1&data=${payload}`, "_blank");
});

/* ================= Collect + validate ================= */

// `fileUrl` turns a picked File into the URL baked into the payload:
// a throwaway blob: URL for the live preview, or the uploaded
// /media/<slug>/… URL when edit mode saves (see publishAdminEdit).
// One preview URL per picked File. The preview is rebuilt on every
// keystroke; minting a fresh blob: URL each time kept every old one
// (and its file) alive until the tab closed.
const previewUrls = new WeakMap();
function previewUrl(file) {
  let url = previewUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    previewUrls.set(file, url);
  }
  return url;
}

function collectFormForPreview(fileUrl = previewUrl) {
  const name = $("f-name").value.trim();
  if (BIRTHDAY_TYPES.has(state.type)) {
    const videoFile = $("f-video-file").files?.[0];
    const musicFile = $("f-music-file").files?.[0];
    return {
      slug:        $("f-slug").value,
      event_type:  state.type,
      name,
      quiz:        readQuiz(),
      memories:    [...memBuilder.querySelectorAll(".mem-row")].map((row) => {
        const file = row.querySelector(".mem-file").files?.[0];
        // Edit mode: when the host hasn't picked a new file for this
        // row, fall back to the already-committed photo URL stashed on
        // the row's dataset — otherwise the preview + save would drop
        // the existing photo. In create mode dataset.existingUrl is
        // absent so this is a no-op.
        return {
          url:       file ? fileUrl(file) : (row.dataset.existingUrl || ""),
          dateLabel: row.querySelector(".mem-date").value.trim(),
        };
      }),
      letterAr:    $("f-letterAr").value,
      letterEn:    $("f-letterEn").value,
      signatureEn: $("f-signatureEn").value,
      signatureAr: $("f-signatureAr").value,
      honorific:   $("f-honorific").value.trim(),
      dateLabel:   $("f-date-label").value.trim(),
      videoUrl:    videoFile ? fileUrl(videoFile) : $("f-video-url").value.trim(),
      musicUrl:    musicFile ? fileUrl(musicFile) : ($("f-music-file").dataset.existingUrl || ""),
    };
  }
  // wedding
  const groom = $("f-groom").value.trim();
  const bride = $("f-bride").value.trim();
  // Each couple-shaped type gets its own eventType label so renderers
  // that branch on CONFIG.couple.eventType (cover.js, event-info.js)
  // pick the right wording. The label is also what the UI shows on
  // the cover headline ("The Wedding of" / "to the engagement of" /
  // "قراية فاتحة" / "سبوع").
  const EVENT_TYPE_LABEL = {
    wedding:        "Wedding",
    "wedding-noir": "Wedding",
    "wedding-burgundy": "Wedding",
    "wedding-wizard": "Wedding",
    engagement:     "Engagement",
    qiraya:         "قراية فاتحة",
    sobou:          "سبوع",
  };
  return {
    slug:        $("f-slug").value,
    event_type:  state.type,
    couple: {
      groom, bride,
      eventType: EVENT_TYPE_LABEL[state.type] || "Wedding",
      groomLabel: "The Groom",
      brideLabel: "The Bride",
      ...(state.type === "wedding-burgundy"
        ? { groomFull: $("f-groom-full").value.trim(), brideFull: $("f-bride-full").value.trim() }
        : {}),
    },
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
    dressCode: {
      label:  $("f-dress-code").value,
      ...(state.type === "wedding-wizard" ? { note: $("f-dress-note").value.trim() } : {}),
      // Pull each live swatch value. Lower-case for consistency; drop
      // the "unset" white sentinel the form seeds the last row with so
      // a 4-colour palette doesn't silently include stray white.
      colors: [...document.querySelectorAll("#dress-colors .cx-color")]
                 .map((el) => (el.value || "").toLowerCase().trim())
                 .filter((c) => c && c !== "#ffffff"),
    },
    gallery:   [...galleryBuilder.querySelectorAll(".mem-row")].map((row) => {
      const file = row.querySelector(".mem-file").files?.[0];
      // Same edit-mode fallback as memories — keep the committed URL
      // when there is no new file for this row.
      return file ? fileUrl(file) : (row.dataset.existingUrl || "");
    }).filter(Boolean),
    // Program / timeline rows the host added. Row display order wins —
    // the renderer doesn't sort by time (hosts occasionally want an
    // out-of-order ceremonial sequence). Rows missing a time OR a
    // label are dropped so the invitation never shows a blank row.
    schedule: [...scheduleBuilder.querySelectorAll(".sched-row")].map((row) => ({
      time:  row.querySelector(".sched-time").value.trim(),
      label: row.querySelector(".sched-label").value.trim(),
    })).filter((it) => it.time && it.label),
    // Contacts — WhatsApp + Call buttons per person on the invitation.
    // Rows missing name OR phone are dropped so the section never
    // shows a half-row. Role is optional.
    contacts: [...contactsBuilder.querySelectorAll(".contact-row")].map((row) => ({
      name:  row.querySelector(".c-name").value.trim(),
      role:  row.querySelector(".c-role").value.trim(),
      phone: row.querySelector(".c-phone").value.trim(),
    })).filter((c) => c.name && c.phone),
    music:     (() => {
      // Edit mode: no new file picked → keep the song already on the
      // invitation instead of saving an empty one.
      const input = $("f-wedding-music");
      const f = input.files?.[0];
      return f ? fileUrl(f) : (input.dataset.existingUrl || "");
    })(),
    ...(state.type === "wedding-burgundy" ? burgundyExtras() : {}),
  };
}

// Fields only Wedding · Burgundy shows. The full names live on `couple`
// so every renderer reads the couple from one place.
function burgundyExtras() {
  const v = (id) => ($(id)?.value || "").trim();
  return {
    families: { groom: v("f-family-groom"), bride: v("f-family-bride") },
    ceremony: { name: v("f-ceremony-place") },
    gift:     { message: v("f-gift-message"), details: v("f-gift-details") },
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
  // Admin-create also needs the host email (an owner on the account
  // this event is being published into). Trim + ultra-light regex.
  const hostEmailEl = $("f-host-email");
  const hostEmailOk = ADMIN_MODE !== "create" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((hostEmailEl?.value || "").trim());
  const canPublish = nameOk && slugOk && codeOk && hostEmailOk;
  $("publish-btn").disabled = !canPublish;
  $("publish-hint").hidden  = canPublish;
  if (!canPublish) {
    const bits = [];
    if (!nameOk)      bits.push("name");
    if (!slugOk)      bits.push("valid available slug");
    if (!codeOk)      bits.push("activation code");
    if (!hostEmailOk) bits.push("host email");
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
  if (!ADMIN_MODE && !(await requireSignIn())) return;
  btn.disabled = true;

  const slug = $("f-slug").value.trim();
  const code = normalizeCode(codeInput.value);
  const type = state.type;

  try {
    // 0. Check the code BEFORE reserving the name or uploading anything,
    //    so a typo costs one round-trip instead of every upload plus a
    //    name that then reads as "taken". Activate re-checks and burns it.
    if (!ADMIN_MODE) {
      setProgress(3, "Checking your code…");
      const chk = await apiJson("POST", "/api/check-code", { code });
      if (!chk.valid) {
        showCodeErr(chk.message || "Invalid activation code.");
        hideProgress();
        btn.disabled = false;
        return;
      }
    }

    // 1. Rename each staged File so the backend commits it at a
    //    predictable path (`<type>/media/<slug>/<name>`) and the payload
    //    we send in step 2 can reference that URL directly.
    const files = prepareFiles(slug, type);
    const finalCfg = buildFinalConfig(files, slug, type);

    // 2. Create the event with the finalized payload. The backend
    //    reserves the slug in its DB here (unique constraint) — this is
    //    what holds the name while the files upload.
    setProgress(5, "Reserving your name…");
    // Admin-create passes the host's email so the backend creates (or
    // finds) a User row and attaches it to this event. Non-admin flows
    // use the signed-in host from the session cookie — the backend
    // takes current_user.id automatically.
    const createBody = { slug, event_type: type, payload_json: finalCfg };
    if (ADMIN_MODE === "create") {
      createBody.host_email = ($("f-host-email")?.value || "").trim().toLowerCase();
    }
    let evt;
    try {
      evt = await apiJson("POST", "/api/events", createBody);
    } catch (err) {
      // Admin picked an email that's already a registered host — the
      // backend refuses silent-linking because an attacker could have
      // squatted the email. Ask the admin to confirm, then retry with
      // the explicit flag.
      if (ADMIN_MODE === "create" && err?.status === 409 && err?.data?.error === "existing_account") {
        const hasPwd = err.data.has_password;
        const ok = confirm(
          `An account for ${err.data.email} already exists ` +
          (hasPwd ? "(the host set a password)."
                  : "(the host hasn't set a password yet).") +
          "\n\nAttach this invitation to that account?"
        );
        if (!ok) throw err;
        createBody.host_email_confirm_existing = true;
        evt = await apiJson("POST", "/api/events", createBody);
      } else {
        throw err;
      }
    }
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
    // Mirror backend _build_public_url — every template except the
    // classic birthday lives at /<type>/<slug>; birthday catches /<slug>.
    const slugPath = type === "birthday"
      ? `/${slug}`
      : `/${type}/${slug}`;
    const publicUrl = act.public_url || `${location.origin}${slugPath}`;
    $("success-url").href = publicUrl;
    $("success-url").textContent = publicUrl;
    // Admin created a brand-new host account: this one-time link is the
    // only way the host can set a password (only its hash is stored).
    if (evt.claim_url) {
      const claimUrl = `${location.origin}${evt.claim_url}`;
      $("claim-url").textContent = claimUrl;
      $("claim-block").hidden = false;
      $("copy-claim-btn").onclick = async () => {
        try {
          await navigator.clipboard.writeText(claimUrl);
          $("copy-claim-btn").textContent = "Copied ✓";
        } catch (_) { /* ignore */ }
      };
    }
    clearDraft();
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
// into the payload matches the filename the backend stores.
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
      ? "Edit your invitation"
      : "Create invitation (admin)";
  }
  const lede = document.querySelector(".cx-lede");
  if (lede) {
    lede.textContent = ADMIN_MODE === "edit"
      ? "Change anything below and press Save — guests see it right away. No activation code needed."
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
  applyType(ALL_TYPES.has(evt.event_type) ? evt.event_type : "birthday");

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
    setIf("f-honorific",   p.honorific);
    setIf("f-date-label",  p.dateLabel);
    setIf("f-video-url",   isLiveUrl(p.videoUrl) ? p.videoUrl : "");
    showExistingAudio("f-music-file", p.musicUrl);
    // Rebuild quiz rows from stored data.
    if (Array.isArray(p.quiz) && p.quiz.length) {
      quizBuilder.innerHTML = "";
      for (const q of p.quiz) addQuizRow(q);
    }
    // Rebuild memory rows from the stored photos — otherwise the host
    // sees an empty row and no way to see / delete / caption the ones
    // they already uploaded. The seed row addMemoryRow() ran at module
    // init is replaced here.
    if (Array.isArray(p.memories) && p.memories.length) {
      memBuilder.innerHTML = "";
      for (const m of p.memories) {
        addMemoryRow({ url: isLiveUrl(m?.url) ? m.url : "", dateLabel: m?.dateLabel });
      }
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
    setIf("f-dress-note",    p.dressCode?.note);
    setIf("f-groom-full",     c.groomFull);
    setIf("f-bride-full",     c.brideFull);
    setIf("f-family-groom",   p.families?.groom);
    setIf("f-family-bride",   p.families?.bride);
    setIf("f-ceremony-place", p.ceremony?.name);
    setIf("f-gift-message",   p.gift?.message);
    setIf("f-gift-details",   p.gift?.details);
    // Pre-fill the colour swatches from the stored palette. Missing
    // slots stay at their seed default so the host can extend an
    // existing palette by just editing the extra swatches.
    const storedColors = Array.isArray(p.dressCode?.colors) ? p.dressCode.colors : [];
    const colorInputs  = document.querySelectorAll("#dress-colors .cx-color");
    storedColors.forEach((hex, i) => {
      const el = colorInputs[i];
      if (el && typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex)) {
        el.value = hex.toLowerCase();
      }
    });
    // Rebuild gallery rows from the stored photos. The seed row
    // addGalleryRow() ran at module init is replaced here so the host
    // doesn't see a stray empty row above their actual photos.
    const gallery = Array.isArray(p.gallery) ? p.gallery.filter(isLiveUrl) : [];
    if (gallery.length) {
      galleryBuilder.innerHTML = "";
      for (const url of gallery) addGalleryRow(url);
    }
    showExistingAudio("f-wedding-music", p.music);
    // Rebuild schedule rows from the stored timeline (if any). An
    // empty schedule leaves the builder blank — host can still add
    // rows via the + button.
    if (Array.isArray(p.schedule) && p.schedule.length) {
      scheduleBuilder.innerHTML = "";
      for (const it of p.schedule) addScheduleRow(it);
    }
    // Rebuild contact rows the same way.
    if (Array.isArray(p.contacts) && p.contacts.length) {
      contactsBuilder.innerHTML = "";
      for (const c of p.contacts) addContactRow(c);
    }
  }

  schedulePreview();
  updatePublishGate();
}

/* A blob: URL only lives inside the tab that created it — older saves
 * baked those into the payload, so treat them as missing. */
function isLiveUrl(u) {
  return typeof u === "string" && u !== "" && !u.startsWith("blob:");
}

/* Edit mode: a file input can't be pre-filled, so show the song that's
 * already on the invitation next to it and keep its URL on the input's
 * dataset — collectFormForPreview falls back to it when no new file is
 * picked. "Remove song" is the only way to drop it. */
function showExistingAudio(inputId, url) {
  const input = $(inputId);
  if (!input || !isLiveUrl(url)) return;
  input.dataset.existingUrl = url;
  const note = document.createElement("div");
  note.className = "cx-hint";
  const label = document.createElement("span");
  label.textContent = `Current song: ${decodeURIComponent(url.split("/").pop())} — pick a file to replace it. `;
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "cx-btn cx-btn-ghost";
  rm.textContent = "Remove song";
  rm.addEventListener("click", () => {
    delete input.dataset.existingUrl;
    note.remove();
    schedulePreview();
  });
  note.append(label, rm);
  input.insertAdjacentElement("afterend", note);
}

/* Every File currently picked anywhere in the form. */
function pickedFiles() {
  const out = [];
  const push = (f, field) => { if (f) out.push({ file: f, field }); };
  memBuilder.querySelectorAll(".mem-row .mem-file").forEach((el) => push(el.files?.[0], "photo"));
  galleryBuilder.querySelectorAll(".mem-row .mem-file").forEach((el) => push(el.files?.[0], "gallery"));
  push($("f-video-file").files?.[0], "video");
  push($("f-music-file").files?.[0], "music");
  push($("f-wedding-music").files?.[0], "music");
  return out;
}

/* Edit-mode "Save changes" handler. Uploads any newly picked files
 * first, then PATCHes the payload with their real /media/<slug>/… URLs
 * (never the preview's blob: URLs). Files the host didn't touch keep
 * their stored URL via the rows' / inputs' dataset.existingUrl. */
async function publishAdminEdit() {
  const btn = $("publish-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const picked = pickedFiles();
    const uploaded = new Map();
    const stamp = Date.now().toString(36);
    for (let i = 0; i < picked.length; i++) {
      const { file, field } = picked[i];
      setProgress(5 + Math.round((i / picked.length) * 80),
                  `Uploading ${i + 1} of ${picked.length}…`);
      // Unique name per save so a re-upload never collides with (or
      // overwrites) a file the live page already points at.
      const name = safeFilename(`${field}-${stamp}-${i + 1}-${file.name}`);
      const res = await uploadFileWithProgress(
        `/admin/api/events/${ADMIN_EDIT_ID}/media`,
        new File([file], name, { type: file.type }),
        () => {},
      );
      uploaded.set(file, res.url);
    }
    const nextPayload = collectFormForPreview((f) => uploaded.get(f) || "");
    if (Array.isArray(nextPayload.memories)) {
      nextPayload.memories = nextPayload.memories.filter((m) => m.url);
    }
    setProgress(90, "Saving changes…");
    await apiJson("PATCH", `/admin/api/events/${ADMIN_EDIT_ID}`, {
      payload_json: nextPayload,
    });
    // Uploaded files are now the "existing" ones — clear the inputs so
    // a second Save doesn't upload them again.
    reseedAfterSave(uploaded);
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

function reseedAfterSave(uploaded) {
  document.querySelectorAll(".mem-row").forEach((row) => {
    const input = row.querySelector(".mem-file");
    const url = uploaded.get(input?.files?.[0]);
    if (!url) return;
    row.dataset.existingUrl = url;
    input.value = "";
    const clr = row.querySelector(".mem-clear");
    if (clr) clr.hidden = true;
  });
  for (const id of ["f-music-file", "f-wedding-music"]) {
    const input = $(id);
    const url = uploaded.get(input.files?.[0]);
    if (!url) continue;
    input.value = "";
    syncClearButton(input);
    input.parentElement.querySelectorAll(".cx-hint").forEach((n) => {
      if (n.textContent.startsWith("Current song")) n.remove();
    });
    showExistingAudio(id, url);
  }
  const v = $("f-video-file");
  const vUrl = uploaded.get(v.files?.[0]);
  if (vUrl) {
    $("f-video-url").value = vUrl;
    v.value = "";
    syncClearButton(v);
  }
}

/* ================= Sign-in at publish + local draft ================= */

// True when a host is signed in. Otherwise saves the draft, shows the
// sign-in panel (its links come back to this page) and returns false.
async function requireSignIn() {
  try {
    const r = await fetch("/user/me", { credentials: "include" });
    const j = r.ok ? await r.json() : { authenticated: true };
    if (j.authenticated) return true;
  } catch (_) {
    return true;   // backend unreachable: let publish surface the real error
  }
  saveDraft();
  const next = encodeURIComponent(`/create.html?type=${state.type}`);
  $("signin-login").href  = `/user/login?next=${next}`;
  $("signin-signup").href = `/user/signup?next=${next}`;
  $("signin-gate").hidden = false;
  $("signin-gate").scrollIntoView({ behavior: "smooth", block: "center" });
  return false;
}

const DRAFT_KEY = "lamma:create-draft";
// Text inputs only — a browser can't keep picked files across pages.
const DRAFT_SKIP = new Set(["f-code", "f-host-email"]);

// Set once publish succeeds: a save still queued by the debounce must
// not write the draft back after clearDraft().
var draftClosed = false;

function saveDraft() {
  if (ADMIN_MODE || draftClosed) return;
  const fields = {};
  document.querySelectorAll("#editor-screen input[id], #editor-screen textarea[id]").forEach((el) => {
    if (el.type === "file" || el.type === "radio" || DRAFT_SKIP.has(el.id)) return;
    fields[el.id] = el.value;
  });
  const draft = {
    v: 1,
    savedAt: Date.now(),
    type: state.type,
    slugEdited: !!$("f-slug").dataset.userEdited,
    fields,
    quiz: [...quizBuilder.querySelectorAll(".q-row")].map((row) => ({
      question: row.querySelector(".q-text").value,
      options: [...row.querySelectorAll(".q-option-text")].map((i) => i.value),
      correctIndex: Math.max(0, [...row.querySelectorAll('input[type="radio"]')].findIndex((r) => r.checked)),
    })),
    schedule: [...scheduleBuilder.querySelectorAll(".sched-row")].map((row) => ({
      time: row.querySelector(".sched-time").value,
      label: row.querySelector(".sched-label").value,
    })),
    contacts: [...contactsBuilder.querySelectorAll(".contact-row")].map((row) => ({
      name: row.querySelector(".c-name").value,
      role: row.querySelector(".c-role").value,
      phone: row.querySelector(".c-phone").value,
    })),
    colors: [...document.querySelectorAll("#dress-colors .cx-color")].map((el) => el.value),
  };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (_) { /* storage off */ }
}

function clearDraft() {
  draftClosed = true;
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
}

function restoreDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (_) {}
  if (!d || d.v !== 1 || !d.fields || typeof d.fields !== "object") return;
  // A template card on the landing page (?type=) for a different
  // template means a new invitation — leave the draft for later.
  const urlType = new URLSearchParams(location.search).get("type");
  if (urlType && urlType !== d.type) return;
  if (ALL_TYPES.has(d.type)) applyType(d.type);
  for (const [id, value] of Object.entries(d.fields)) {
    const el = document.getElementById(id);
    if (el && typeof value === "string" && el.type !== "file") el.value = value;
  }
  if (Array.isArray(d.quiz) && d.quiz.length) {
    quizBuilder.innerHTML = "";
    d.quiz.forEach((q) => addQuizRow({
      question: q.question || "",
      options: Array.isArray(q.options) ? q.options : ["", "", ""],
      correctIndex: q.correctIndex || 0,
    }));
  }
  if (Array.isArray(d.schedule) && d.schedule.length) {
    scheduleBuilder.innerHTML = "";
    d.schedule.forEach((it) => addScheduleRow(it));
  }
  if (Array.isArray(d.contacts) && d.contacts.length) {
    contactsBuilder.innerHTML = "";
    d.contacts.forEach((c) => addContactRow(c));
  }
  if (Array.isArray(d.colors)) {
    document.querySelectorAll("#dress-colors .cx-color").forEach((el, i) => {
      if (/^#[0-9a-f]{6}$/i.test(d.colors[i] || "")) el.value = d.colors[i];
    });
  }
  if (d.slugEdited) $("f-slug").dataset.userEdited = "1";
  const slug = $("f-slug").value.trim();
  if (slug) checkSlug(slug).then(updatePublishGate);
  updateSlugLink();
  schedulePreview();
  updatePublishGate();

  const note = $("draft-note");
  note.textContent = `Restored what you typed on ${new Date(d.savedAt).toLocaleString()}. Photos and music need to be picked again. `;
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "cx-btn cx-btn-ghost";
  reset.textContent = "Start over";
  reset.addEventListener("click", () => {
    clearDraft();
    location.href = `/create.html?type=${state.type}`;
  });
  note.appendChild(reset);
  note.hidden = false;
}

/* ================= boot (last: all `let` bindings are alive) ================= */

const initialType = new URLSearchParams(location.search).get("type");
applyType(ALL_TYPES.has(initialType) ? initialType : "birthday");

applyAdminChrome();
loadAdminEditFixtures();

// Admin create needs to know which host account the invitation
// belongs to — show the Host email field and gate Publish on it.
if (ADMIN_MODE === "create") {
  const wrap = $("host-email-wrapper");
  if (wrap) wrap.style.display = "";
  // Re-check the publish gate when the host email changes.
  $("f-host-email")?.addEventListener("input", updatePublishGate);
}

// Visitors fill and preview first; sign-in is asked at Publish (see
// requireSignIn). The form is kept as a draft on this device so a
// sign-in round trip — or a closed tab — doesn't lose it.
if (!ADMIN_MODE) {
  restoreDraft();
  const editor = document.getElementById("editor-screen");
  editor.addEventListener("input",  debounce(saveDraft, 600));
  editor.addEventListener("change", debounce(saveDraft, 600));
}

// Telemetry: tell the backend that someone opened the create form so
// the admin's Leads tab can surface visitors who didn't make it to
// publish. Fire-and-forget — no auth, no body validation on failure,
// no UX change if the endpoint is down. Admin + edit modes don't ping
// (that would double-count the host as a lead on their own event).
if (!ADMIN_MODE) {
  try {
    fetch("/api/leads", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: state.type || "unknown" }),
    }).catch(() => { /* telemetry failure is non-fatal */ });
  } catch (_) { /* ignore */ }
}
