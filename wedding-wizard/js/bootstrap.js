// ============================================================================
//  Wedding · Wizard bootstrap (same flow as wedding-burgundy/js/bootstrap.js).
//
//  Resolves the slug (?for=<slug>, path /wedding-wizard/<slug>, or root
//  demo), fetches /data/<slug>.json from the server, and MERGES the result
//  into the mutable CONFIG object BEFORE dynamically importing any renderer
//  module. Because CONFIG's individual properties are mutated in place,
//  every renderer sees the correct couple / program / venue when it runs.
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
import { previewBanner, trustedPreview } from "/js/preview-guard.js?v=fcba6238";


const RENDERER_MODULES = [
  "./intro.js?v=de4e3bcf",     "./content.js?v=c50569a3",   "./countdown.js?v=42d298ee",
  "./ics.js?v=fdb9bdd9",       "./rsvp.js?v=67a1d75c",      "./contacts.js?v=8ac65200",
  "./guestbook.js?v=f8e8df70", "./footsteps.js?v=e28486b8", "./reveal.js?v=3986f32d",    "./view-ping.js?v=ec6e9ac1",
];

const RESERVED_SEG = new Set([
  "", "wedding", "wedding-burgundy", "wedding-noir", "wedding-wizard", "wedding-blue", "birthday", "birthday-elegant",
  "engagement", "qiraya", "sobou", "admin", "create",
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
  // Only our own /create may hand this page content (js/preview-guard.js).
  if (!trustedPreview()) return null;
  previewBanner();
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
  if (Array.isArray(data.schedule))       CONFIG.schedule = data.schedule
    .filter((it) => it && typeof it.time === "string" && typeof it.label === "string");
  if (Array.isArray(data.contacts))       CONFIG.contacts = data.contacts
    .filter((c) => c && typeof c.name === "string" && typeof c.phone === "string");
  if (typeof data.music === "string")     CONFIG.music    = data.music;
  if (typeof data.slug === "string")      CONFIG.slug     = data.slug;
}

// A real invitation (or a preview of one) starts from blanks, so the demo
// couple's program, dress code and note never show up on a page whose host
// left those fields empty.
function clearDemo() {
  CONFIG.dressCode = { label: "", colors: [], note: "" };
  CONFIG.schedule = [];
  CONFIG.contacts = [];
  CONFIG.blessing = "";
  CONFIG.music = "";
}

async function loadRenderers() {
  // Sequential — some renderers race for the same DOM ids; the original
  // <script> tag order was intentional.
  for (const path of RENDERER_MODULES) {
    try { await import(path); }
    catch (e) { console.error("[wizard-bootstrap]", path, e); }
  }
}

// Preview: forward any postMessage from the parent create form into a
// URL-based reload. Debounced so a fast typer doesn't reload every
// keystroke.
if (isPreview()) {
  let lastEncoded = new URLSearchParams(location.search).get("data") || "";
  let reloadTimer = null;
  window.addEventListener("message", (e) => {
    // Only our own /create page may drive the preview — any other site
    // could frame this page and render its own content under our name.
    if (e.origin !== location.origin) return;
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
    if (data) { clearDemo(); mergeInvitation(data); }
    // Skip the intro in preview — the tap inside an iframe would be lost
    // on every form change (location.replace resets it), so the host would
    // never see the letter, venue or RSVP. Set before the renderers run, so
    // intro.js doesn't start the owl video in the hidden intro on every
    // keystroke's reload.
    document.body.classList.add("opened", "settled", "preview");
    await loadRenderers();
    // Mark sections visible so reveal.js doesn't leave them at opacity:0.
    for (const s of document.querySelectorAll(".section, .reveal")) {
      s.classList.add("in-view");
      s.classList.add("is-visible");
    }
    return;
  }

  const slug = resolveSlug();
  let found = false;
  if (slug) {
    let loaded = false;
    // 1. Backend's local-disk /data/<slug>.json — this is where every
    //    wedding published through /create lands since commit 93df6bc.
    try {
      const res = await fetch(`/data/${slug}.json`, { cache: "no-store" });
      if (res.ok) {
        clearDemo();
        mergeInvitation(await res.json());
        CONFIG.slug = slug;
        found = true;
        loaded = true;
      }
    } catch (_) { /* not published — handled below */ }
  }
  // No slug: the bare /wedding-wizard/ demo renders.
  // The URL named an invitation but nothing is published under it —
  // say so instead of showing the demo couple as if it were real.
  if (slug && !found) {
    const { showNotFound } = await import("/js/not-found.js");
    showNotFound();
    return;
  }
  if (!CONFIG.slug) CONFIG.slug = "demo";

  await loadRenderers();
})();
