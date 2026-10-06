// ============================================================================
//  Shared reveal-on-scroll: any element with class="reveal" fades + rises
//  once it enters the viewport. Kept in its own module so every section can
//  opt in without duplicating IntersectionObserver plumbing.
// ============================================================================

const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
);

function observeAll() {
  document.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => io.observe(el));
}

// Observe now (for anything present at parse time) and whenever the invitation
// is opened (in case sections were hidden inside a display:none container).
observeAll();
document.addEventListener("DOMContentLoaded", observeAll);

// Re-scan when the cover opens — reveal thresholds re-check as content shows.
new MutationObserver(observeAll).observe(document.body, {
  attributes: true,
  attributeFilter: ["class"],
});
