// Shared module — the real code is /js/shared/ics.js.
import { CONFIG } from "../config.js";
import { initCalendarLinks } from "/js/shared/ics.js?v=2ff093ac";

initCalendarLinks(CONFIG);

// "Add to Calendar" opens a small menu with the two options.
const toggle = document.getElementById("add-cal");
const menu   = document.getElementById("cal-menu");
if (toggle && menu) {
  toggle.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute("aria-expanded", String(!menu.hidden));
  });
}
