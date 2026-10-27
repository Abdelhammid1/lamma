// Shared module — the real code is /js/shared/contacts.js. Arabic wording.
import { CONFIG } from "../config.js";
import { renderContacts } from "/js/shared/contacts.js?v=9e12b16c";

renderContacts(CONFIG, { text: { whatsapp: "واتساب", call: "اتصال" } });
