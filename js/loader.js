// ============================================================================
//  Loader — figures out which invitation to render and fetches its JSON.
//
//  Slug resolution priority:
//    1. ?for=<slug> in query string (works on localhost + previews)
//    2. First path segment of location.pathname
//         /medo   → medo
//         /sara   → sara
//         /       → null (landing)
//         /admin  → null (admin panel, handled by _redirects)
//    3. First DNS label of the hostname (subdomain fallback)
//
//  Data-source waterfall for load:
//    1. Firestore  invitations/{slug}      ← self-serve created via /create
//    2. GitHub raw birthday-media/data/…    ← legacy admin-created invitations
//         (raw is tried before jsdelivr; the CDN had 12–24h stale-cache issues)
// ============================================================================

import { CONFIG } from "../config.js";
import { db }     from "./firebase-init.js";
import { doc, getDoc } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const RESERVED_PATHS   = new Set([
  "", "admin", "create", "wedding",
  "index.html", "admin.html", "birthday.html", "create.html",
  "logo.jpg", "favicon.ico",
]);
const RESERVED_LABELS  = new Set(["admin", "www", "api", "lamma"]);


export function getSlug() {
  // 1. Query string (dev / preview / explicit override)
  const params = new URLSearchParams(location.search);
  const queryFor = params.get("for");
  if (queryFor) return queryFor.toLowerCase().trim();

  // 2. Path — /medo → "medo"
  const seg = location.pathname.replace(/^\/+|\/+$/g, "").split("/")[0].toLowerCase();
  if (seg && !RESERVED_PATHS.has(seg) && !seg.includes(".")) {
    return seg;
  }

  // 3. Subdomain (only when hosted under CONFIG.domain and not a reserved label)
  const host = location.hostname;
  if (host.endsWith("." + CONFIG.domain) && host !== CONFIG.domain) {
    const label = host.split(".")[0];
    if (label && !RESERVED_LABELS.has(label)) return label.toLowerCase();
  }

  return null;
}


/**
 * Fetch the invitation JSON for a slug.
 * Firestore is authoritative for anything created via /create; the
 * legacy GitHub path is a fallback for old admin-created invitations
 * (Ranon, etc.). Returns null if not found in either.
 */
export async function loadBirthday(slug) {
  // 1. Firestore
  try {
    const snap = await getDoc(doc(db, "invitations", slug));
    if (snap.exists()) return _mapFirestoreDoc(snap.data());
  } catch (e) {
    console.warn("[loader] Firestore lookup failed, trying GitHub:", e);
  }

  // 2. Legacy GitHub — raw first (fresh), CDN as safety net
  const bust = Date.now();
  const paths = [
    `${CONFIG.rawBase}/data/${slug}.json?nc=${bust}`,
    `${CONFIG.cdnBase}/data/${slug}.json?nc=${bust}`,
  ];
  for (const url of paths) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch (_) { /* try next */ }
  }

  return null;
}


/** Firestore stores an invitation with full media URLs already resolved
 *  (Firebase Storage download URLs). Just pass through. */
function _mapFirestoreDoc(data) {
  return data;
}


/**
 * For GitHub-legacy invitations, memories/video have repo-relative
 * `path` fields that need turning into absolute CDN URLs. Firestore
 * docs already store full URLs so this is a no-op there.
 */
export function mapPathsToUrls(cfg) {
  const cdn = CONFIG.cdnBase;
  if (Array.isArray(cfg.memories)) {
    cfg.memories = cfg.memories.map((m) => ({
      ...m,
      url: m.url || (m.path ? `${cdn}/${m.path}` : ""),
    }));
  }
  if (!cfg.videoUrl && cfg.videoPath) {
    cfg.videoUrl = `${cdn}/${cfg.videoPath}`;
  }
  return cfg;
}
