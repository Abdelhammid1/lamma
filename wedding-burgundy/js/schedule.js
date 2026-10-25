// Shared module — the real code is /js/shared/schedule.js.
import { CONFIG } from "../config.js";
import { renderSchedule } from "/js/shared/schedule.js?v=736d9964";

renderSchedule(CONFIG);   // 12-hour, "5:30 PM"
