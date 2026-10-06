// ============================================================================
//  birthday-elegant bootstrap.
//
//  Resolves the slug, fetches the invitation JSON from local disk → Firestore,
//  merges fields into CONFIG, then renders everything into the static DOM.
//  No separate renderer modules — the template is simple enough (letter +
//  memories + optional video) that one pass of DOM writes is cheaper to
//  read and maintain than a 10-file module stack.
// ============================================================================

import { CONFIG } from "../config.js";
import { db }     from "./firebase-init.js";
import { doc, getDoc } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const RESERVED_SEG = new Set([
  "", "birthday", "birthday-elegant", "wedding", "wedding-noir",
  "engagement", "qiraya", "sobou", "admin", "create",
  "index.html", "admin.html", "create.html",
]);

const _SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const _SAFE_URL_RE  = /^(https?:|\/\/|\/)/i;
const _cleanUrl = (u) =>
  (typeof u === "string" && _SAFE_URL_RE.test(u.trim())) ? u.trim() : "";

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

function sanitize(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  if (Array.isArray(data.memories)) {
    out.memories = data.memories.map((m) => ({
      ...m,
      url: _cleanUrl(m?.url),
    }));
  }
  if ("videoUrl" in data) out.videoUrl = _cleanUrl(data.videoUrl);
  if ("musicUrl" in data) out.musicUrl = _cleanUrl(data.musicUrl);
  return out;
}

function mergeInvitation(raw) {
  const data = sanitize(raw);
  if (!data || typeof data !== "object") return;
  if (typeof data.name        === "string") CONFIG.name        = data.name;
  if (typeof data.honorific   === "string") CONFIG.honorific   = data.honorific;
  if (typeof data.dateLabel   === "string") CONFIG.dateLabel   = data.dateLabel;
  if (typeof data.letterAr    === "string") CONFIG.letterAr    = data.letterAr;
  if (typeof data.letterEn    === "string") CONFIG.letterEn    = data.letterEn;
  if (typeof data.signatureEn === "string") CONFIG.signatureEn = data.signatureEn;
  if (typeof data.signatureAr === "string") CONFIG.signatureAr = data.signatureAr;
  if (typeof data.videoUrl    === "string") CONFIG.videoUrl    = data.videoUrl;
  if (typeof data.musicUrl    === "string") CONFIG.musicUrl    = data.musicUrl;
  if (Array.isArray(data.memories))         CONFIG.memories    = data.memories;
}

/* ================== Renderers ================== */

function $(id) { return document.getElementById(id); }
function setText(id, v) { const el = $(id); if (el) el.textContent = v ?? ""; }

function renderCover() {
  setText("cover-name",    CONFIG.name    || "Name");
  setText("cover-eyebrow", CONFIG.honorific || "A Birthday");
  setText("cover-date",    CONFIG.dateLabel || "");
}

function renderLetter() {
  const arEl   = $("letter-ar");
  const enEl   = $("letter-en");
  const ruleEl = $("letter-rule");
  const sigEn  = $("signature-en");
  const sigAr  = $("signature-ar");

  const ar = (CONFIG.letterAr || "").trim();
  const en = (CONFIG.letterEn || "").trim();
  if (arEl) arEl.textContent = ar;
  if (enEl) enEl.textContent = en;
  // Hide the gold rule between languages when only one is present.
  if (ruleEl) ruleEl.classList.toggle("hide", !(ar && en));
  if (sigEn) sigEn.textContent = CONFIG.signatureEn || "With love";
  if (sigAr) sigAr.textContent = CONFIG.signatureAr || "";
}

function renderMemories() {
  const section = $("memories");
  const grid    = $("memories-grid");
  if (!section || !grid) return;
  const items = (CONFIG.memories || []).filter((m) => m && m.url);
  if (!items.length) { section.hidden = true; return; }
  section.hidden = false;
  grid.innerHTML = "";
  for (const m of items) {
    const cell = document.createElement("div");
    cell.className = "memory-cell";
    const frame = document.createElement("div");
    frame.className = "frame";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt     = "";
    img.src     = m.url;
    frame.appendChild(img);
    cell.appendChild(frame);
    if (m.dateLabel) {
      const d = document.createElement("div");
      d.className = "date-label";
      d.textContent = m.dateLabel;
      cell.appendChild(d);
    }
    grid.appendChild(cell);
  }
}

function renderVideo() {
  const section = $("video-section");
  const wrap    = $("video-container");
  if (!section || !wrap) return;
  const url = (CONFIG.videoUrl || "").trim();
  if (!url) { section.hidden = true; return; }
  section.hidden = false;
  wrap.innerHTML = "";
  // Local upload / mp4 → <video>. Everything else (YouTube / Vimeo) → <iframe>.
  const isFile = /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) || url.startsWith("blob:");
  if (isFile) {
    const v = document.createElement("video");
    v.src = url;
    v.controls = true;
    v.playsInline = true;
    wrap.appendChild(v);
  } else {
    const f = document.createElement("iframe");
    f.src = url;
    f.loading = "lazy";
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    f.allowFullscreen = true;
    f.referrerPolicy = "no-referrer-when-downgrade";
    wrap.appendChild(f);
  }
}

function wireOpen() {
  const btn    = $("open-btn");
  const audio  = $("bg-audio");
  const musBtn = $("music-toggle");

  if (audio && CONFIG.musicUrl) {
    audio.src = CONFIG.musicUrl;
    audio.volume = 0.4;
    audio.loop = true;
  }

  if (btn) {
    btn.addEventListener("click", () => {
      if (document.body.classList.contains("opened")) return;
      document.body.classList.add("opened");
      const inv = $("invitation");
      if (inv) inv.setAttribute("aria-hidden", "false");

      if (audio && audio.src) {
        audio.muted = false;
        audio.play().catch(() => { /* autoplay blocked — user can tap toggle */ });
        if (musBtn) {
          musBtn.hidden = false;
          musBtn.classList.add("playing");
        }
      }

      // Reveal any section that is already in the viewport now that the
      // invitation has become visible — IntersectionObserver was attached
      // while #invitation had max-height:0, so initial fire reported them
      // as not intersecting and nothing scrolls into view until the user
      // moves the wheel.
      requestAnimationFrame(() => {
        for (const sec of document.querySelectorAll(".section")) {
          const r = sec.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) {
            sec.classList.add("in-view");
          }
        }
      });

      setTimeout(() => {
        if (inv) inv.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 400);
    });
  }

  if (musBtn && audio) {
    musBtn.addEventListener("click", async () => {
      audio.muted = !audio.muted;
      musBtn.classList.toggle("playing", !audio.muted);
      if (!audio.muted) { try { await audio.play(); } catch (_) { /* ignore */ } }
    });
  }
}

function wireReveal() {
  // Reduced motion → everything in-view immediately.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".section").forEach((s) => s.classList.add("in-view"));
    return;
  }
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".section").forEach((s) => s.classList.add("in-view"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in-view");
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.15 });
  document.querySelectorAll(".section").forEach((s) => io.observe(s));
}

function renderAll() {
  renderCover();
  renderLetter();
  renderMemories();
  renderVideo();
  wireOpen();
  wireReveal();
}

/* ================== Preview-mode message forwarding ================== */

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

/* ================== Boot ================== */

(async function boot() {
  if (isPreview()) {
    const data = decodePreviewData();
    if (data) mergeInvitation(data);
    renderAll();
    return;
  }

  const slug = resolveSlug();
  if (slug) {
    let loaded = false;
    // 1. Backend's local-disk /data/<slug>.json — the current publish path.
    try {
      const res = await fetch(`/data/${slug}.json`, { cache: "no-store" });
      if (res.ok) {
        mergeInvitation(await res.json());
        CONFIG.slug = slug;
        loaded = true;
      }
    } catch (_) { /* try Firestore */ }

    // 2. Firestore fallback — invitations created in the pre-backend flow.
    if (!loaded && db) {
      try {
        const snap = await getDoc(doc(db, "invitations", slug));
        if (snap.exists()) {
          mergeInvitation(snap.data());
          CONFIG.slug = slug;
        }
      } catch (e) {
        console.warn("[birthday-elegant] Firestore fetch failed:", e);
      }
    }
  }
  if (!CONFIG.slug) CONFIG.slug = "demo";

  renderAll();
})();
