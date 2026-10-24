// Shared module — the real code is /js/shared/schedule.js.
import { CONFIG } from "../config.js";
import { renderSchedule } from "/js/shared/schedule.js?v=736d9964";

renderSchedule(CONFIG, { clock24: true });   // "17:30", like the rest of this template
