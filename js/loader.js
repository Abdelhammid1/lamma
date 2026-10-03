// ============================================================================
//  Loader — figures out which invitation to render and fetches its JSON.
//
//  Slug resolution priority:
//    1. ?for=<slug> in query string (works on localhost + previews)
//    2. Path segments — /medo → medo,  /wedding/sara → sara
//    3. First DNS label of the hostname (subdomain fallback)
//
//  Data-source waterfall for load:
//    1. Firestore  invitations/{slug}      ← self-serve created via /create
//    2. GitHub raw birthday-media/data/…    ← legacy admin-created invitations
//         (raw is tried before jsdelivr; the CDN had 12–24h stale-cache issues)
// ============================================================================

import { CONFIG }      from "../config.js";
import { db }          from "./firebase-init.js";
import { RESERVED_SLUGS } from "./reserved-slugs.js";
import { doc, getDoc } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const RESERVED_LABELS  = new Set(["admin", "www", "api", "lamma"]);


export function getSlug() {
  // 1. Query string (dev / preview / explicit override)
  const params = new URLSearchParams(location.search);
  const queryFor = params.get("for");
  if (queryFor) return queryFor.toLowerCase().trim();

  // 2. Path — walk segments so /wedding/sara resolves to "sara".
  const segs = location.pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  for (const seg of segs) {
    if (!seg || seg.includes(".")) continue;
    if (RESERVED_SLUGS.has(seg))   continue;
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
  // 1. Backend's own /data/<slug>.json — the current publish path
  //    writes here (nginx alias → MEDIA_SERVE_DIR). Fastest + fresh.
  try {
    const res = await fetch(`/data/${slug}.json`, { cache: "no-store" });
    if (res.ok) return sanitizeConfigUrls(await res.json());
  } catch (_) { /* try next source */ }

  // 2. Firestore — invitations created via the old /create (pre-backend).
  try {
    const snap = await getDoc(doc(db, "invitations", slug));
    if (snap.exists()) return sanitizeConfigUrls(_mapFirestoreDoc(snap.data()));
  } catch (e) {
    console.warn("[loader] Firestore lookup failed, trying GitHub:", e);
  }

  // 3. GitHub — legacy admin publishes (Ranon, Rana) and the brief
  //    period when the backend committed to <type>/data/<slug>.json.
  //    Raw first (fresh), CDN as safety net.
  const bust = Date.now();
  const paths = [
    `${CONFIG.rawBase}/data/${slug}.json?nc=${bust}`,
    `${CONFIG.rawBase}/birthday/data/${slug}.json?nc=${bust}`,
    `${CONFIG.rawBase}/wedding/data/${slug}.json?nc=${bust}`,
    `${CONFIG.cdnBase}/data/${slug}.json?nc=${bust}`,
    `${CONFIG.cdnBase}/birthday/data/${slug}.json?nc=${bust}`,
    `${CONFIG.cdnBase}/wedding/data/${slug}.json?nc=${bust}`,
  ];
  for (const url of paths) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return sanitizeConfigUrls(await res.json());
    } catch (_) { /* try next */ }
  }

  return null;
}


/** Firestore stores an invitation with full media URLs already resolved
 *  (Firebase Storage download URLs). Just pass through. */
function _mapFirestoreDoc(data) {
  return data;
}


/* Sanitize every URL field in a loaded invitation BEFORE handing it to
 * the template. The payload comes from local disk / Firestore / GitHub —
 * any of those can be hostile if the uploader got creative (an attacker
 * could publish an invitation whose `videoUrl` is `javascript:…` or
 * `data:text/html,…` and have the template render it into an <iframe>).
 * Allowlist: http, https, protocol-relative, and site-relative paths.
 * Everything else is replaced with an empty string so the template
 * silently skips it. */
const _SAFE_URL_RE = /^(https?:|\/\/|\/)/i;
export function sanitizeConfigUrls(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  const clean = (u) => (typeof u === "string" && _SAFE_URL_RE.test(u.trim())) ? u.trim() : "";
  const out = { ...cfg };
  if (Array.isArray(cfg.memories)) {
    out.memories = cfg.memories.map((m) => ({ ...m, url: clean(m?.url) }));
  }
  if (Array.isArray(cfg.gallery)) {
    out.gallery = cfg.gallery.map(clean).filter(Boolean);
  }
  if ("videoUrl" in cfg) out.videoUrl = clean(cfg.videoUrl);
  if ("musicUrl" in cfg) out.musicUrl = clean(cfg.musicUrl);
  if ("music"    in cfg) out.music    = clean(cfg.music);
  return out;
}


/**
 * For GitHub-legacy invitations, memories/video have repo-relative
 * `path` fields that need turning into absolute CDN URLs. Firestore
 * docs already store full URLs so this is a no-op there.
 *
 * Returns a shallow copy — never mutates the caller's object.
 */
export function mapPathsToUrls(cfg) {
  const cdn = CONFIG.cdnBase;
  const out = { ...cfg };
  if (Array.isArray(cfg.memories)) {
    out.memories = cfg.memories.map((m) => ({
      ...m,
      url: m.url || (m.path ? `${cdn}/${m.path}` : ""),
    }));
  }
  if (!out.videoUrl && out.videoPath) {
    out.videoUrl = `${cdn}/${out.videoPath}`;
  }
  return out;
}
