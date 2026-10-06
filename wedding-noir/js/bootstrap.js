// ============================================================================
//  Wedding bootstrap.
//
//  Resolves the wedding slug (?for=<slug>, path /wedding/<slug>, or root
//  demo), fetches invitations/{slug} from Firestore, and MERGES the result
//  into the mutable CONFIG object BEFORE dynamically importing any renderer
//  module. Because CONFIG's individual properties are mutated in place,
//  every renderer sees the correct couple / gallery / venue when it runs.
//
//  Preview mode (?preview=1) is used by /create's iframe. On first load
//  the module also decodes ?data=<base64 json> so the initial paint matches
//  the form. Live updates from the parent create-form.js arrive as
//  postMessage({type:'lamma:preview', cfg}); the module re-encodes them
//  into ?data= and does a location.replace so the whole page re-renders
//  with the new config — simpler and more correct than trying to make the
//  12 renderer modules re-runnable.
// ============================================================================

import { CONFIG } from "../config.js";
import { db }     from "./firebase-init.js";
import { doc, getDoc } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const RENDERER_MODULES = [
  "./cover.js",       "./announcement.js", "./gallery.js",
  "./event-info.js",  "./countdown.js",    "./calendar.js",
  "./ics.js",         "./rsvp.js",         "./venue.js",
  "./dress-code.js",  "./guestbook.js",    "./reveal.js",
];

const RESERVED_SEG = new Set([
  "", "wedding", "wedding-noir", "birthday", "birthday-elegant",
  "engagement", "qiraya", "sobou",
  "admin", "create",
  "index.html", "admin.html", "create.html",
]);

// Slug shape must match what the backend enforces at create time:
// lowercase letters / digits / hyphens, 2–40 chars, no leading/
// trailing hyphen. Validating here blocks path traversal through
// `?for=../admin/settings` → browser normalizing fetch(`/data/...`)
// to an attacker-chosen location.
const _SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

function resolveSlug() {
  const params = new URLSearchParams(location.search);
  const forParam = (params.get("for") || "").toLowerCase().trim();
  if (forParam) return _SAFE_SLUG_RE.test(forParam) ? forParam : null;

  const segs = location.pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  // /wedding/sara → sara ;  /sara → sara (rare — wedding usually under /wedding)
  for (const seg of segs) {
    if (!RESERVED_SEG.has(seg) && _SAFE_SLUG_RE.test(seg)) return seg;
  }
  return null;
}

function isPreview() {
  return new URLSearchParams(location.search).get("preview") === "1";
}

function decodePreviewData() {
  const raw = new URLSearchParams(location.search).get("data");
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(raw)))));
  } catch (_) {
    return null;
  }
}

function encodePreviewData(cfg) {
  return encodeURIComponent(
    btoa(unescape(encodeURIComponent(JSON.stringify(cfg || {}))))
  );
}

// Mirrors sanitizeConfigUrls in js/loader.js — accept only http(s),
// protocol-relative (//), or site-relative (/) URLs. Blocks the
// `javascript:` + `data:text/html,…` payloads a hostile customer could
// bake into their invitation and have the venue iframe or gallery <img>
// execute. Kept inline rather than cross-importing loader.js so this
// module stays independent of the birthday renderer stack.
const _SAFE_URL_RE = /^(https?:|\/\/|\/)/i;
const _cleanUrl = (u) =>
  (typeof u === "string" && _SAFE_URL_RE.test(u.trim())) ? u.trim() : "";

function sanitizeWeddingData(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  if (Array.isArray(data.gallery)) out.gallery = data.gallery.map(_cleanUrl).filter(Boolean);
  if ("music" in data)             out.music   = _cleanUrl(data.music);
  // Venue has an iframe src (mapsEmbedSrc) + a deep link; sanitize both.
  if (data.venue && typeof data.venue === "object") {
    out.venue = {
      ...data.venue,
      ...(data.venue.mapsEmbedSrc ? { mapsEmbedSrc: _cleanUrl(data.venue.mapsEmbedSrc) } : {}),
      ...(data.venue.mapsDeepLink ? { mapsDeepLink: _cleanUrl(data.venue.mapsDeepLink) } : {}),
    };
  }
  return out;
}

function mergeInvitation(raw) {
  const data = sanitizeWeddingData(raw);
  if (!data || typeof data !== "object") return;
  if (data.couple    && typeof data.couple    === "object") Object.assign(CONFIG.couple,    data.couple);
  if (data.event     && typeof data.event     === "object") Object.assign(CONFIG.event,     data.event);
  if (data.venue     && typeof data.venue     === "object") Object.assign(CONFIG.venue,     data.venue);
  if (data.dressCode && typeof data.dressCode === "object") Object.assign(CONFIG.dressCode, data.dressCode);
  if (typeof data.blessing === "string")  CONFIG.blessing = data.blessing;
  if (Array.isArray(data.gallery))        CONFIG.gallery  = data.gallery.filter(Boolean);
  if (typeof data.music === "string")     CONFIG.music    = data.music;
  if (typeof data.slug === "string")      CONFIG.slug     = data.slug;
}

async function loadRenderers() {
  // Sequential — some renderers race for the same DOM ids; the original
  // <script> tag order was intentional.
  for (const path of RENDERER_MODULES) {
    try { await import(path); }
    catch (e) { console.error("[wedding-bootstrap]", path, e); }
  }
}

// Preview: forward any postMessage from the parent create form into a
// URL-based reload. Debounced so a fast typer doesn't reload every
// keystroke.
if (isPreview()) {
  let lastEncoded = new URLSearchParams(location.search).get("data") || "";
  let reloadTimer = null;
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "lamma:preview") return;
    let enc;
    try { enc = encodePreviewData(e.data.cfg); }
    catch (_) { return; }
    if (enc === lastEncoded) return;
    lastEncoded = enc;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const url = new URL(location.href);
      url.searchParams.set("preview", "1");
      url.searchParams.set("data", enc);
      location.replace(url.toString());
    }, 350);
  });
}

(async function boot() {
  if (isPreview()) {
    const data = decodePreviewData();
    if (data) mergeInvitation(data);
    await loadRenderers();
    // Auto-open the invitation in preview mode so the create form's
    // iframe shows the full page content, not just the cover. The Open
    // button requires a user gesture and every form change triggers a
    // location.replace that would reset the "opened" state, so the
    // user otherwise never sees their photo gallery / venue / RSVP /
    // guestbook. All sections are also marked in-view so the fade-up
    // reveal doesn't hide them when preview re-renders.
    document.body.classList.add("opened");
    // Collapse the cover so the iframe doesn't open on 100vh of blank
    // space at the top. Fading it to opacity:0 still reserves its space.
    const cover = document.getElementById("cover");
    if (cover) cover.style.display = "none";
    // Synchronous — rAF is unreliable for off-screen / background iframes.
    for (const s of document.querySelectorAll(".section, .reveal")) {
      s.classList.add("in-view");
      s.classList.add("is-visible");
    }
    return;
  }

  const slug = resolveSlug();
  if (slug) {
    let loaded = false;
    // 1. Backend's local-disk /data/<slug>.json — this is where every
    //    wedding published through /create lands since commit 93df6bc.
    //    Without this lookup, weddings loaded from local disk fell
    //    through to Firestore (never set) and rendered the demo
    //    (Ahmed & Sara).
    try {
      const res = await fetch(`/data/${slug}.json`, { cache: "no-store" });
      if (res.ok) {
        mergeInvitation(await res.json());
        CONFIG.slug = slug;
        loaded = true;
      }
    } catch (_) { /* try Firestore */ }

    // 2. Firestore — invitations created via the pre-backend /create
    //    (while the publish flow still wrote Firebase docs).
    if (!loaded) {
      try {
        const snap = await getDoc(doc(db, "invitations", slug));
        if (snap.exists()) {
          mergeInvitation(snap.data());
          CONFIG.slug = slug;
        }
      } catch (e) {
        console.warn("[wedding-bootstrap] Firestore fetch failed:", e);
      }
    }
  }
  // If no slug was found, the demo (Ahmed & Sara) still renders — that's
  // /wedding/ landing behavior. We tag it as "demo" so the demo's guestbook
  // + rsvp writes go under invitations/demo/*, not the legacy root.
  if (!CONFIG.slug) CONFIG.slug = "demo";

  await loadRenderers();
})();
