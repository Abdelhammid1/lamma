// Entry point — resolves the slug from /qiraya/<slug>, fetches the
// payload from the server's /data/<slug>.json, merges into CONFIG, then
// loads each renderer in order. Mirrors engagement/js/bootstrap.js;
// kept separate so this template stays self-contained.

import { CONFIG } from "../config.js";
import { db }     from "./firebase-init.js";
import { doc, getDoc } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const RENDERER_MODULES = [
  "./cover.js",
  "./details.js",
  "./countdown.js",
  "./venue.js",
  "./guestbook.js",
  "./reveal.js",
];

const RESERVED_SEG = new Set([
  "", "qiraya", "engagement", "wedding", "birthday", "sobou",
  "admin", "create", "index.html", "admin.html", "create.html",
]);

// Slug shape must match what the backend enforces at create time:
// lowercase letters / digits / hyphens, 2–40 chars, and must not start
// or end with a hyphen. Blocking anything else here closes a path-
// traversal vector where a hostile `?for=../admin/settings` would make
// the subsequent fetch(`/data/${slug}.json`) resolve to a different
// location after browser URL normalization.
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
  for (const seg of segs) {
    if (!RESERVED_SEG.has(seg) && _SAFE_SLUG_RE.test(seg)) return seg;
  }
  return null;
}

/* URL-scheme allowlist. Blocks `javascript:` + `data:text/html` smuggled
 * into the published JSON by a hostile uploader. */
const _SAFE_URL_RE = /^(https?:|\/\/|\/)/i;
const _cleanUrl = (u) =>
  (typeof u === "string" && _SAFE_URL_RE.test(u.trim())) ? u.trim() : "";

function sanitizeQiraya(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  if (Array.isArray(data.gallery)) out.gallery = data.gallery.map(_cleanUrl).filter(Boolean);
  if ("music" in data)             out.music   = _cleanUrl(data.music);
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
  const data = sanitizeQiraya(raw);
  if (!data || typeof data !== "object") return;
  if (data.couple && typeof data.couple === "object") Object.assign(CONFIG.couple, data.couple);
  if (data.event  && typeof data.event  === "object") Object.assign(CONFIG.event,  data.event);
  if (data.venue  && typeof data.venue  === "object") Object.assign(CONFIG.venue,  data.venue);
  if (typeof data.blessing    === "string") CONFIG.blessing    = data.blessing;
  if (typeof data.quote       === "string") CONFIG.quote       = data.quote;
  if (typeof data.quoteSource === "string") CONFIG.quoteSource = data.quoteSource;
  if (typeof data.music       === "string") CONFIG.music       = data.music;
  if (typeof data.slug        === "string") CONFIG.slug        = data.slug;
}

async function loadRenderers() {
  for (const path of RENDERER_MODULES) {
    try { await import(path); }
    catch (e) { console.error("[qiraya-bootstrap]", path, e); }
  }
}

/* ================== Preview-mode support ==================
   Lets /create's iframe show the live template as the host types. The
   create form sends postMessage({type:"lamma:preview", cfg}); we encode
   that into ?data=<base64> and location.replace so the whole page re-
   renders with the new config (simpler + more correct than re-running
   every renderer module). On boot, if ?preview=1, we decode ?data=,
   merge into CONFIG, collapse the cover (the Open gesture would never
   fire inside the iframe), and mark sections visible immediately. */

function isPreview() {
  return new URLSearchParams(location.search).get("preview") === "1";
}
function decodePreviewData() {
  const raw = new URLSearchParams(location.search).get("data");
  if (!raw) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(raw))))); }
  catch (_) { return null; }
}
function encodePreviewData(cfg) {
  return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(cfg || {})))));
}

if (isPreview()) {
  let lastEncoded = new URLSearchParams(location.search).get("data") || "";
  let reloadTimer = null;
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "lamma:preview") return;
    let enc;
    try { enc = encodePreviewData(e.data.cfg); } catch (_) { return; }
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
    // Collapse the cover and reveal every section so the iframe shows
    // the full invitation body instead of 100vh of blank cover space.
    document.body.classList.add("opened");
    const cover = document.getElementById("cover");
    if (cover) cover.style.display = "none";
    for (const s of document.querySelectorAll(".section, .reveal")) {
      s.classList.add("in-view");
      s.classList.add("is-visible");
    }
    return;
  }

  const slug = resolveSlug();
  if (slug) {
    let loaded = false;
    try {
      const res = await fetch(`/data/${slug}.json`, { cache: "no-store" });
      if (res.ok) {
        mergeInvitation(await res.json());
        CONFIG.slug = slug;
        loaded = true;
      }
    } catch (_) { /* try Firestore */ }
    if (!loaded && db) {
      try {
        const snap = await getDoc(doc(db, "invitations", slug));
        if (snap.exists()) {
          mergeInvitation(snap.data());
          CONFIG.slug = slug;
        }
      } catch (e) {
        console.warn("[qiraya-bootstrap] Firestore fetch failed:", e);
      }
    }
  }
  if (!CONFIG.slug) CONFIG.slug = "demo";
  await loadRenderers();
})();
