// Shared module — the real code is /js/shared/guestbook.js.
import { CONFIG } from "../config.js";
import { initGuestbook } from "/js/shared/guestbook.js?v=cabc152e";

initGuestbook(CONFIG);
