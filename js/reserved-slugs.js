// ============================================================================
//  Shared reserved-slug list.
//  A slug in this set may never be claimed by a user's invitation:
//    - it collides with a top-level route (admin, create, wedding, …)
//    - it collides with a static file / folder deployed at the root
//    - or it's a keyword we want to keep for future use
//  Both create-form.js (write side, uniqueness gate) and loader.js
//  (read side, "which slug does the URL point at?") import from here so
//  the two lists cannot drift.
// ============================================================================

export const RESERVED_SLUGS = new Set([
  // Routes / product surfaces
  "", "admin", "create", "wedding", "birthday", "invitation",
  "lamma", "landing",

  // Deployed static files at the site root (nginx serves these directly)
  "index", "index.html", "admin.html", "birthday.html", "create.html",
  "logo", "logo.jpg", "favicon", "favicon.ico",
  "images", "css", "js", "audio", "video", "assets",
  "robots", "robots.txt", "sitemap", "sitemap.xml",
  "data-recovery", "data",

  // Test / demo names — protect the fallback in template.js
  "demo", "test", "preview",

  // DNS / infra labels we never want a user to own
  "www", "mail", "ftp", "api", "cdn", "static", "media",

  // Company / sister-product subdomains under manasety.ai
  "marsoud", "lexoffice", "almustashar", "activefit", "school",
  "elyasmin", "chatwoot", "n8n", "qaffer", "blog", "support",
  "help", "status",

  // Legal / marketing pages that may exist later
  "about", "contact", "terms", "privacy", "pricing", "faq",
]);
