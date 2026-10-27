// ============================================================================
//  3D carousel (right to left: the next photo waits on the left): the
//  current photo large and framed in the middle, the
//  neighbours turned away on each side. Turns by itself every few seconds
//  while it is on screen; swipe, arrows, keyboard; tap the middle photo for
//  the full-screen viewer, tap a side photo to bring it in.
// ============================================================================

import { CONFIG } from "../config.js";
import { ar } from "./arabic.js?v=32c7962b";

const $ = (id) => document.getElementById(id);
const images = (Array.isArray(CONFIG.gallery) ? CONFIG.gallery : []).filter(Boolean);
const section = $("gallery"), track = $("car-track");

let current = 0;
const slides = [];

if (!images.length) {
  if (section) section.hidden = true;
} else if (track) {
  images.forEach((src, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "slide";
    b.setAttribute("aria-label", `صورة ${ar(i + 1)} من ${ar(images.length)}`);
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = i < 3 ? "eager" : "lazy";
    img.decoding = "async";
    b.appendChild(img);
    b.addEventListener("click", () => {
      if (swiped) return;
      if (i === current) openLightbox(i); else go(i);
    });
    track.appendChild(b);
    slides.push(b);
  });
  if (images.length === 1) section.classList.add("single");
  layout();
}

// Shortest signed distance from the current slide, so the ring wraps.
function offset(i) {
  const n = images.length;
  let k = i - current;
  if (k > n / 2) k -= n;
  if (k < -n / 2) k += n;
  return k;
}

function layout() {
  slides.forEach((el, i) => {
    const k = offset(i), a = Math.abs(k);
    el.style.setProperty("--k", k);
    el.style.setProperty("--a", a);
    el.classList.toggle("is-current", k === 0);
    el.style.visibility = a > 2 ? "hidden" : "visible";
    el.tabIndex = k === 0 ? 0 : -1;
  });
}

function go(i) {
  current = (i + images.length) % images.length;
  layout();
  autoplay();                    // a fresh full wait after every move
}

$("car-prev")?.addEventListener("click", () => go(current - 1));
$("car-next")?.addEventListener("click", () => go(current + 1));
$("carousel")?.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft")  go(current + 1);   // right to left: left is "next"
  if (e.key === "ArrowRight") go(current - 1);
});

// Swipe: only a clearly sideways drag moves a photo. Scrolling the page
// up or down across the carousel (even a little diagonally) used to count
// as a swipe and flip photos while the guest was just reading on.
let start = null;
let swiped = false;              // the click that follows a swipe is not a tap
track?.addEventListener("pointerdown", (e) => {
  if (!e.isPrimary) return;
  start = { x: e.clientX, y: e.clientY, scroll: window.scrollY };
  autoplay();                    // never turn under the guest's finger
});
track?.addEventListener("pointercancel", () => { start = null; });   // the browser took over: a scroll
track?.addEventListener("pointerup", (e) => {
  if (!start || !e.isPrimary) return;
  const dx = e.clientX - start.x, dy = e.clientY - start.y;
  const pageMoved = Math.abs(window.scrollY - start.scroll) > 4;
  start = null;
  // Any drag (swipe or not) is not a tap: ignore the click that follows,
  // or a drag ending on the middle photo would open the full-screen viewer.
  if (Math.hypot(dx, dy) > 10) {
    swiped = true;
    setTimeout(() => { swiped = false; }, 0);
  }
  if (pageMoved || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 2) return;
  go(current + (dx > 0 ? 1 : -1));   // right to left: drag the next photo in from the left
});

/* ---------- Full-screen viewer ---------- */
const lb = $("lightbox"), lbImg = $("lightbox-image"), lbCount = $("lightbox-counter");
let lbIndex = 0;
function openLightbox(i) {
  if (!lb) return;
  lbIndex = i;
  showLb();
  lb.classList.add("open");
  document.body.classList.add("lightbox-open");
  $("lightbox-close")?.focus();
}
function closeLightbox() {
  lb?.classList.remove("open");
  document.body.classList.remove("lightbox-open");
}
function showLb() {
  lbImg.src = images[lbIndex];
  lbImg.alt = `صورة ${ar(lbIndex + 1)} من ${ar(images.length)}`;
  lbCount.textContent = `${ar(lbIndex + 1)} / ${ar(images.length)}`;
}
function stepLb(d) { lbIndex = (lbIndex + d + images.length) % images.length; showLb(); }
$("lightbox-close")?.addEventListener("click", closeLightbox);
$("lightbox-prev")?.addEventListener("click", () => stepLb(-1));
$("lightbox-next")?.addEventListener("click", () => stepLb(1));
lb?.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });
document.addEventListener("keydown", (e) => {
  if (!lb?.classList.contains("open")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") stepLb(1);
  if (e.key === "ArrowRight") stepLb(-1);
});

/* ---------- Turning by itself ---------- */
// One photo every few seconds, but only while the carousel is on screen, the
// tab is visible, the full-screen viewer is closed and no finger is down.
// Any move (swipe, tap, arrow) starts the wait again. Guests who asked their
// phone for reduced motion get a still carousel.
const AUTO_MS = 4000;
const still = images.length < 2 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let onScreen = false, autoTimer = 0;
function autoplay() {
  clearTimeout(autoTimer);
  if (still) return;
  autoTimer = setTimeout(() => {
    if (onScreen && !document.hidden && !start && !lb?.classList.contains("open")) go(current + 1);
    else autoplay();
  }, AUTO_MS);
}
if (!still && section) {
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }, { threshold: 0.5 }).observe(section);
  autoplay();
}
