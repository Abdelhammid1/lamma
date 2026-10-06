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

function resolveSlug() {
  const params = new URLSearchParams(location.search);
  const forParam = params.get("for");
  if (forParam) return forParam.toLowerCase().trim();
  const segs = location.pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((s) => s.toLowerCase())
    .filter(Boolean);
  for (const seg of segs) {
    if (!RESERVED_SEG.has(seg) && !seg.includes(".")) return seg;
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

(async function boot() {
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
