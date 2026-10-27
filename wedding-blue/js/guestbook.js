// Shared module — the real code is /js/shared/guestbook.js. Arabic wording.
import { CONFIG } from "../config.js";
import { initGuestbook } from "/js/shared/guestbook.js?v=cabc152e";
import { ar } from "./arabic.js?v=32c7962b";

initGuestbook(CONFIG, {
  locale: "ar-EG",
  text: {
    nameMissing: "من فضلك اكتب اسمك.", messageMissing: "من فضلك اكتب تهنئتك.",
    sending: "جارٍ إرسال التهنئة…", saved: "شكرًا لك، وصلت تهنئتك 💌",
    failed: "حدث خطأ، حاول مرة أخرى.", loadFailed: "تعذّر تحميل التهاني الآن.",
    justNow: "الآن",
    minutesAgo: (n) => `منذ ${ar(n)} دقيقة`,
    hoursAgo: (n) => `منذ ${ar(n)} ساعة`,
    daysAgo: (n) => `منذ ${ar(n)} يوم`,
  },
});
