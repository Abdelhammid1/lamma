// Entry point. Resolves the slug (from the URL), fetches the backend
// data JSON, merges it into the mutable CONFIG object BEFORE loading
// any renderer module, and then imports each renderer sequentially
// (some share DOM ids so their execution order matters).
//
// Hardening: every URL field pulled from the fetched payload is
// scrubbed against an allowlist of http/https/relative URLs — see
// sanitizeEngagementData below. Mirrors wedding/js/bootstrap.js.

import { CONFIG } from "../config.js";
import { db }     from "./firebase-init.js";
import { doc, getDoc } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const RENDERER_MODULES = [
  "./cover.js",
  "./details.js",
  "./countdown.js",
  "./venue.js",
  "./dress-code.js",
  "./gallery.js",
  "./guestbook.js",
  "./reveal.js",
];

const RESERVED_SEG = new Set([
  "", "engagement", "wedding", "birthday", "admin", "create",
  "index.html", "admin.html", "create.html",
]);

// Slug fence — matches the backend's _SAFE_SLUG. Blocks the `?for=
// ../admin/settings` pattern where browser URL normalization on
// fetch(`/data/${slug}.json`) would resolve to an attacker-chosen
// path outside /data/.
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

/* Allowlist URL schemes. See the same sanitizer in js/loader.js and
 * wedding/js/bootstrap.js — kept inline so every template can stay
 * self-contained. */
const _SAFE_URL_RE = /^(https?:|\/\/|\/)/i;
const _cleanUrl = (u) =>
  (typeof u === "string" && _SAFE_URL_RE.test(u.trim())) ? u.trim() : "";

function sanitizeEngagementData(data) {
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
  const data = sanitizeEngagementData(raw);
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
  for (const path of RENDERER_MODULES) {
    try { await import(path); }
    catch (e) { console.error("[engagement-bootstrap]", path, e); }
  }
}

/* ================== Preview-mode support ==================
   /create's iframe sends postMessage({type:"lamma:preview", cfg}) as
   the host types. We encode that into ?data=<base64> and
   location.replace so the whole page re-renders with the new config.
   On boot in preview mode we auto-collapse the cover and reveal every
   section — the Open gesture would never fire inside the iframe, and
   leaving the cover means a blank 100vh at the top of the preview. */

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
    document.body.classList.add("opened");
    const cover = document.getElementById("cover");
    if (cover) cover.style.display = "none";
    // <main class="scroll"> stays opacity:0 until cover.js's Open
    // handler adds .revealed. In preview the Open handler never fires.
    const scrollEl = document.getElementById("scroll");
    if (scrollEl) {
      scrollEl.classList.add("revealed");
      scrollEl.setAttribute("aria-hidden", "false");
    }
    for (const s of document.querySelectorAll(".section, .reveal")) {
      s.classList.add("in-view");
      s.classList.add("is-visible");
    }
    return;
  }

  const slug = resolveSlug();
  if (slug) {
    let loaded = false;
    // 1. Backend's local-disk /data/<slug>.json (per commit 93df6bc).
    try {
      const res = await fetch(`/data/${slug}.json`, { cache: "no-store" });
      if (res.ok) {
        mergeInvitation(await res.json());
        CONFIG.slug = slug;
        loaded = true;
      }
    } catch (_) { /* try Firestore */ }

    // 2. Firestore — pre-backend invitations (if any) created during
    //    the brief Firebase window.
    if (!loaded && db) {
      try {
        const snap = await getDoc(doc(db, "invitations", slug));
        if (snap.exists()) {
          mergeInvitation(snap.data());
          CONFIG.slug = slug;
        }
      } catch (e) {
        console.warn("[engagement-bootstrap] Firestore fetch failed:", e);
      }
    }
  }
  if (!CONFIG.slug) CONFIG.slug = "demo";

  await loadRenderers();
})();
