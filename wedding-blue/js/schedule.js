// Shared module — the real code is /js/shared/schedule.js. Arabic times.
import { CONFIG } from "../config.js";
import { renderSchedule } from "/js/shared/schedule.js?v=14f3953e";
import { arTime } from "./arabic.js?v=32c7962b";

renderSchedule(CONFIG, { formatTime: arTime });   // "٧:٣٠ م"
