// IntersectionObserver-driven fade-up for each .section once it enters
// the viewport. One class flip, respects prefers-reduced-motion via
// the CSS media query — no JS needed to disable.

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      e.target.classList.add("in-view");
      io.unobserve(e.target);
    }
  }
}, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

for (const s of document.querySelectorAll(".section")) io.observe(s);
