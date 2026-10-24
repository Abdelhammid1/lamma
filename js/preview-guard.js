// ============================================================================
//  Preview data (?preview=1&data=…) is only trusted when OUR /create page
//  shows it: in its preview iframe, or in the tab its "Open in new tab"
//  button opened. Anything else is a hand-made link, which could show a
//  fake couple or fake payment details on lamma.manasety.ai — so its data
//  is ignored and the plain demo renders instead.
//  Used by every template's bootstrap (and the classic birthday).
// ============================================================================

const CREATE_PATHS = new Set(["/create", "/create.html"]);

// The window must be our create page itself — same origin is not enough,
// or any other page on the site that frames or opens this one (say, an
// invitation embedding a crafted preview URL) would count as trusted.
function isCreatePage(win) {
  try {
    return !!win && win.location.origin === location.origin
      && CREATE_PATHS.has(win.location.pathname);
  } catch (_) { return false; }            // cross-origin: access throws
}

export function trustedPreview() {
  if (window.parent !== window) return isCreatePage(window.parent);
  return isCreatePage(window.opener);
}

// In a tab of its own (not the iframe), say plainly that this is a preview.
export function previewBanner() {
  if (window.parent !== window || document.getElementById("lamma-preview-banner")) return;
  const bar = document.createElement("div");
  bar.id = "lamma-preview-banner";
  bar.setAttribute("role", "status");
  bar.textContent = "Preview — not a published invitation";
  bar.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px 12px;" +
    "background:#1f1f1f;color:#fff;font:600 13px/1.4 system-ui,sans-serif;" +
    "text-align:center;letter-spacing:.02em;";
  const show = () => document.body && document.body.prepend(bar);
  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
}
