// ============================================================================
//  Footsteps that walk down the invitation as the guest scrolls, like the
//  Marauder's Map: one trail winding left and right from the map to the
//  last section. Each step appears where the guest has scrolled to and
//  fades behind them, so only the last few show; scrolling back up walks
//  them back. One SVG over the page, one <use> per step; only the steps
//  near the walker are touched on each scroll.
// ============================================================================

const page = document.getElementById("invitation");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SVG = "http://www.w3.org/2000/svg";
const TRAIL = 10;                    // steps visible behind the walker (5 pairs)

if (page && !reduceMotion) {
  const layer = document.createElementNS(SVG, "svg");
  layer.setAttribute("class", "footsteps");
  layer.setAttribute("aria-hidden", "true");
  page.appendChild(layer);

  let steps = [];                    // [{ el, y }], top to bottom
  let shown = [];                    // indexes currently not at opacity 0

  // Lay the trail out for the page as it is now (its height changes as
  // sections reveal, the RSVP form opens and wishes load).
  function layout() {
    layer.setAttribute("height", "0");               // measure the page, not the old trail
    const w = page.clientWidth, h = page.scrollHeight;
    if (!w || !h) return;
    layer.setAttribute("width", String(w));
    layer.setAttribute("height", String(h));
    layer.replaceChildren();
    steps = [];
    shown = [];
    const wide = w >= 900;
    const stride = wide ? 64 : 52;                    // down the page per step
    const swing = Math.min(w * 0.36, 520);            // how far it winds left and right
    const period = wide ? 1500 : 1100;                // one full left-right-left
    const gap = wide ? 22 : 18;                       // between left and right foot
    const fw = wide ? 24 : 20, fh = Math.round(fw * 34 / 20);   // one print
    const x = (y) => w / 2 + swing * Math.sin((y / period) * 2 * Math.PI);
    for (let i = 0, y = 160; y < h - 80; i++, y += stride) {
      // The drawing's toes point up; turn them along the path, downwards.
      const heading = Math.atan2(2, x(y + 1) - x(y - 1));   // radians, 90° = straight down
      const angle = (heading * 180) / Math.PI + 90;
      const side = i % 2 ? 1 : -1;                    // -1: left foot, 1: right foot
      const rad = heading + Math.PI / 2;              // across the path
      const px = x(y) + side * gap * Math.cos(rad);
      const py = y + side * gap * Math.sin(rad);
      const use = document.createElementNS(SVG, "use");
      use.setAttribute("href", "#footprint");
      use.setAttribute("width", String(fw));
      use.setAttribute("height", String(fh));
      use.setAttribute("x", String(-fw / 2));
      use.setAttribute("y", String(-fh / 2));
      // The drawing is a left foot; the right foot is its mirror image.
      use.setAttribute("transform", `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${angle.toFixed(1)}) scale(${-side} 1)`);
      use.setAttribute("class", "step");
      layer.appendChild(use);
      steps.push({ el: use, y });
    }
    update();
  }

  // The walker is a little below the middle of the screen.
  function update() {
    raf = 0;
    if (!steps.length) return;
    const top = page.getBoundingClientRect().top;
    const walker = window.innerHeight * 0.62 - top;
    // Last step at or above the walker.
    let lo = 0, hi = steps.length - 1, last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (steps[mid].y <= walker) { last = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const next = [];
    for (let k = last; k >= 0 && k > last - TRAIL; k--) {
      const age = last - k;
      steps[k].el.style.opacity = String(((1 - age / TRAIL) * 0.9).toFixed(2));
      next.push(k);
    }
    for (const k of shown) if (!next.includes(k)) steps[k].el.style.opacity = "0";
    shown = next;
  }

  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  new ResizeObserver(() => layout()).observe(page);
}
