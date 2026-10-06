// Gallery — a square grid of photos. CONFIG.gallery is an array of
// URLs (resolved to the local /media/<slug>/<file> path by create.html
// when the couple published). Empty array hides the whole section
// (via .empty class) so a bare invitation doesn't show an empty block.

import { CONFIG } from "../config.js";

const grid = document.getElementById("gallery-grid");
if (grid) {
  const urls = Array.isArray(CONFIG.gallery) ? CONFIG.gallery.filter(Boolean) : [];
  if (!urls.length) {
    grid.classList.add("empty");
    const section = document.getElementById("gallery");
    if (section) section.hidden = true;
  } else {
    for (const src of urls) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      cell.appendChild(img);
      grid.appendChild(cell);
    }
  }
}
