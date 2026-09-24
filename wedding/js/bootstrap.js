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
  "", "wedding", "birthday", "admin", "create",
  "index.html", "admin.html", "create.html",
]);

function resolveSlug() {
  const params = new URLSearchParams(location.search);
  const forParam = params.get("for");
  if (forParam) return forParam.toLowerCase().trim();

  const segs = location.pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  // /wedding/sara → sara ;  /sara → sara (rare — wedding usually under /wedding)
  for (const seg of segs) {
    if (!RESERVED_SEG.has(seg) && !seg.includes(".")) return seg;
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

function mergeInvitation(data) {
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
    return;
  }

  const slug = resolveSlug();
  if (slug) {
    try {
      const snap = await getDoc(doc(db, "invitations", slug));
      if (snap.exists()) {
        const data = snap.data();
        mergeInvitation(data);
        CONFIG.slug = slug;
      }
    } catch (e) {
      console.warn("[wedding-bootstrap] Firestore fetch failed:", e);
    }
  }
  // If no slug was found, the demo (Ahmed & Sara) still renders — that's
  // /wedding/ landing behavior. We tag it as "demo" so the demo's guestbook
  // + rsvp writes go under invitations/demo/*, not the legacy root.
  if (!CONFIG.slug) CONFIG.slug = "demo";

  await loadRenderers();
})();
