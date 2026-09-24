// ============================================================================
//  Gallery + lightbox
//    - Renders tiles from CONFIG.gallery into #gallery-grid
//    - First image is the "hero" tile (spans a larger area via CSS)
//    - Broken/missing image src → the tile shows its CSS placeholder background
//    - Click a tile → full-screen lightbox with prev/next + ESC + arrow keys +
//      click-outside-to-close
// ============================================================================

import { CONFIG } from "../config.js";

const grid       = document.getElementById("gallery-grid");
const lightbox   = document.getElementById("lightbox");
const lbImage    = document.getElementById("lightbox-image");
const lbCounter  = document.getElementById("lightbox-counter");
const lbClose    = document.getElementById("lightbox-close");
const lbPrev     = document.getElementById("lightbox-prev");
const lbNext     = document.getElementById("lightbox-next");

const images = Array.isArray(CONFIG.gallery) ? CONFIG.gallery : [];
let currentIndex = 0;

/* ---------------- Render tiles ---------------- */
if (grid) {
  images.forEach((src, i) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "gallery-item" + (i === 0 ? " hero" : "");
    tile.setAttribute("aria-label", `Open photo ${i + 1}`);
    tile.dataset.index = String(i);

    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => tile.classList.add("broken"));

    // Small numbered label shows through when the image is missing.
    const badge = document.createElement("span");
    badge.className = "gallery-badge";
    badge.textContent = String(i + 1);

    tile.append(badge, img);
    tile.addEventListener("click", () => openLightbox(i));
    grid.appendChild(tile);
  });
}

/* ---------------- Lightbox ---------------- */
function openLightbox(index) {
  if (!lightbox || !images.length) return;
  currentIndex = index;
  updateLightbox();
  lightbox.classList.add("open");
  document.body.classList.add("lightbox-open");
  lbClose && lbClose.focus();
}

function closeLightbox() {
  if (!lightbox) return;
  lightbox.classList.remove("open");
  document.body.classList.remove("lightbox-open");
}

function step(delta) {
  if (!images.length) return;
  currentIndex = (currentIndex + delta + images.length) % images.length;
  updateLightbox();
}

function updateLightbox() {
  if (!lbImage || !lbCounter) return;
  lbImage.src = images[currentIndex];
  lbImage.alt = `Photo ${currentIndex + 1} of ${images.length}`;
  lbCounter.textContent = `${currentIndex + 1} / ${images.length}`;
}

if (lbClose) lbClose.addEventListener("click", closeLightbox);
if (lbPrev)  lbPrev.addEventListener("click",  () => step(-1));
if (lbNext)  lbNext.addEventListener("click",  () => step(+1));

if (lightbox) {
  // Click on the backdrop (but not on the inner content) closes.
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
}

document.addEventListener("keydown", (e) => {
  if (!lightbox || !lightbox.classList.contains("open")) return;
  if (e.key === "Escape")     closeLightbox();
  if (e.key === "ArrowRight") step(+1);
  if (e.key === "ArrowLeft")  step(-1);
});
