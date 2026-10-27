// ============================================================================
//  Wedding · Blue Blooms (زفاف · زهور زرقاء) — demo content, in Arabic. A
//  published invitation replaces these values with its own
//  /data/<slug>.json (see js/bootstrap.js).
// ============================================================================

export const CONFIG = {
  couple: {
    groom: "عمر",
    bride: "ليلى",
    // Optional full names for the ceremony section; fall back to the short ones.
    groomFull: "عمر حسن",
    brideFull: "ليلى محمود",
    eventType: "زفاف",
    groomLabel: "العريس",
    brideLabel: "العروسة",
  },

  // The opening line(s) above the names. Empty → none.
  verse: "بسم الله الرحمن الرحيم\nوَمِنْ آيَاتِهِ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا لِّتَسْكُنُوا إِلَيْهَا",

  // One line (or two, separated by a line break) per family.
  families: {
    groom: "السيد / حسن عبد الرحمن\nوحرمه",
    bride: "السيد / محمود فاروق\nوحرمه",
  },

  event: {
    datetimeIso: "2027-12-12T19:00:00+02:00",
    welcomeTime: "18:00",
    receptionTime: "20:30",
    durationHours: 5,
  },

  // Where the ceremony happens, if it's somewhere other than the venue.
  ceremony: {
    name: "مسجد السيدة نفيسة",
  },

  venue: {
    name: "قاعة الماسة",
    address: "مصر الجديدة، القاهرة",
    mapsEmbedSrc: "",
    mapsDeepLink: "",
  },

  blessing: "بقلوب يملؤها الفرح نتشرف بدعوتكم لحضور حفل زفافنا",

  dressCode: {
    label: "ملابس سهرة",
    colors: ["#1e2d4f", "#3f5687", "#a9c4e6"],
  },

  schedule: [
    { time: "18:30", label: "استقبال الضيوف" },
    { time: "19:00", label: "عقد القران" },
    { time: "19:45", label: "الصور التذكارية" },
    { time: "20:30", label: "دخول العروسين" },
    { time: "21:30", label: "العشاء" },
    { time: "23:00", label: "تقطيع التورتة" },
  ],

  contacts: [],

  gift: {
    message: "حضوركم هو أجمل هدية لنا",
    details: "",
  },

  gallery: [
    "images/demo-1.svg",
    "images/demo-2.svg",
    "images/demo-3.svg",
  ],
  music: "",
};
