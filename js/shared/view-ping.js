// view-ping.js — one tiny beacon per public page load so the host can
// see how many people opened their invitation. Backend dedupes to one
// "unique" view per visitor_hash per day; this file just fires once.
//
// Skipped when:
//   - URL carries ?preview=1 (admin / host self-preview)
//   - The browser can't send beacons at all (no sendBeacon + no fetch)
//
// Host-session + bot filtering happens server-side; the client doesn't
// need to know who the current user is.
//
//  Shared by every template: each template's js/view-ping.js passes its own
//  CONFIG in. Edit here, not in the template folders.

export function pingView(CONFIG) {

  const SLUG = CONFIG.slug || "";
  if (SLUG && !/[?&]preview=1\b/.test(location.search)) {
    const url = `/api/invitations/${encodeURIComponent(SLUG)}/view`;
    try {
      if (navigator.sendBeacon) {
        // Empty body — the server reads request headers + remote addr.
        navigator.sendBeacon(url, new Blob([""], { type: "text/plain" }));
      } else if (typeof fetch === "function") {
        fetch(url, { method: "POST", keepalive: true, credentials: "same-origin" }).catch(() => {});
      }
    } catch (_) { /* best-effort — never surface to the guest */ }
  }
}
