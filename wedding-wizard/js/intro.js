// ============================================================================
//  Intro: the owl video (when the template has one), then "Tap anywhere".
//  The tap is the one user gesture that may start the music. It opens the
//  envelope scene: the wand touches the wax seal, the seal comes close with
//  the couple's names, and the invitation opens at the map. After the video
//  (which already shows the envelope opening) the tap goes straight to the
//  seal with the names.
// ============================================================================

import { CONFIG } from "../config.js";

const $ = (id) => document.getElementById(id);
const body = document.body;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Names on the seals ---------- */
const groom = CONFIG.couple?.groom || "";
const bride = CONFIG.couple?.bride || "";
const initial = (name) => Array.from(name.trim())[0] || "";
document.querySelectorAll("[data-groom]").forEach((el) => (el.textContent = groom));
document.querySelectorAll("[data-bride]").forEach((el) => (el.textContent = bride));
const short = initial(groom) + initial(bride);
document.querySelectorAll("[data-monogram]").forEach((el) => {
  el.textContent = short ? `${initial(groom)}&${initial(bride)}` : "";
});
document.querySelectorAll("[data-monogram-short]").forEach((el) => (el.textContent = short));

/* ---------- Music ---------- */
const audio    = $("bg-audio");
const musicBtn = $("music-toggle");
if (audio && CONFIG.music) {
  audio.src = CONFIG.music;
  audio.loop = true;
  audio.volume = 0.5;
  if (musicBtn) musicBtn.hidden = false;
}
if (musicBtn && audio) {
  musicBtn.addEventListener("click", async () => {
    if (audio.paused) {
      try { await audio.play(); musicBtn.classList.add("playing"); } catch (_) { /* ignore */ }
    } else {
      audio.pause();
      musicBtn.classList.remove("playing");
    }
  });
}

/* ---------- The owl video ---------- */
const intro = $("intro");
const video = $("intro-video");
const tapText = $("tap-text");

function readyToTap(text) {
  intro?.classList.remove("playing");
  if (tapText) tapText.textContent = text;
}

let videoPlayed = false;
const src = typeof CONFIG.introVideo === "string" ? CONFIG.introVideo.trim() : "";
if (video && src && /^\/[^/]/.test(src) && !body.classList.contains("preview")) {
  video.hidden = false;
  video.src = src;
  intro.classList.add("playing");
  video.addEventListener("playing", () => { videoPlayed = true; });
  video.addEventListener("ended", () => readyToTap("Tap anywhere to continue"));
  // No file, or the browser won't play it muted (some battery savers):
  // the castle stays and the guest taps on as if it had ended.
  video.addEventListener("error", () => { video.hidden = true; readyToTap("Tap anywhere to begin the magic"); });
  const p = video.play();
  if (p && p.catch) p.catch(() => readyToTap("Tap anywhere to continue"));
}

/* ---------- Tap → envelope → seal → invitation ---------- */
const timers = [];
function finish() {
  timers.forEach(clearTimeout);
  if (body.classList.contains("opened")) return;
  body.classList.add("opened");
  window.scrollTo({ top: 0 });
  // Once the scene has faded, take it out of the page entirely.
  setTimeout(() => body.classList.add("settled"), reduceMotion ? 0 : 800);
}

$("open-btn")?.addEventListener("click", () => {
  if (body.classList.contains("env") || body.classList.contains("opened")) return;
  if (video && !video.paused) video.pause();
  if (audio && CONFIG.music) {
    audio.play().then(() => musicBtn && musicBtn.classList.add("playing"))
      .catch((err) => console.warn("bg music blocked:", err));
  }
  if (reduceMotion) { finish(); return; }
  if (videoPlayed) {
    body.classList.add("env", "from-video");
    // One frame with the scene shown, then the seal, so it grows in.
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.add("seal")));
    timers.push(setTimeout(finish, 3200));
    return;
  }
  body.classList.add("env");
  timers.push(setTimeout(() => body.classList.add("seal"), 2600));
  timers.push(setTimeout(finish, 5600));
});

$("skip-intro")?.addEventListener("click", finish);
