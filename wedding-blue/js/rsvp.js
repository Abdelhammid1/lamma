// Shared module — the real code is /js/shared/rsvp.js. Arabic wording.
import { CONFIG } from "../config.js";
import { initRsvp } from "/js/shared/rsvp.js?v=6fc06b7f";

initRsvp(CONFIG, {
  text: {
    open: "تأكيد الحضور", hide: "إخفاء",
    nameMissing: "من فضلك اكتب اسمك.", sending: "جارٍ الإرسال…",
    thanksYes: "شكرًا لك! وصلنا تأكيد حضورك، في انتظارك.",
    thanksNo: "شكرًا لإبلاغنا، سنفتقدك.",
    failedWith: () => "تعذّر إرسال الرد، حاول مرة أخرى.",
    failed: "تعذّر إرسال الرد، حاول مرة أخرى.",
  },
});
