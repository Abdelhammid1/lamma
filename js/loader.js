// ============================================================================
//  Loader — figures out which birthday to render and fetches its JSON.
//
//  Slug resolution priority:
//    1. ?for=<slug> in query string (works on localhost + previews)
//    2. First path segment of location.pathname
//         /medo   → medo
//         /sara   → sara
//         /       → null (landing)
//         /admin  → null (admin panel, handled by _redirects)
//    3. First DNS label of the hostname (subdomain fallback, if a wildcard
//         DNS record is later added)
// ============================================================================

import { CONFIG } from "../config.js";

const RESERVED_PATHS   = new Set(["", "admin", "index.html", "admin.html", "birthday.html", "logo.jpg", "favicon.ico"]);
const RESERVED_LABELS  = new Set(["admin", "www", "api", "lamma"]);

export function getSlug() {
  // 1. Query string (dev / preview)
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

/** Fetch the birthday JSON from the CDN, falling back to raw on 404. */
export async function loadBirthday(slug) {
  const paths = [
    `${CONFIG.cdnBase}/data/${slug}.json`,
    `${CONFIG.rawBase}/data/${slug}.json`,
  ];
  for (const url of paths) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch (_) { /* try next */ }
  }
  return null;
}

/** Convert repo-relative `path` fields to absolute CDN URLs. */
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
