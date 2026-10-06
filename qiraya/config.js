// ============================================================================
//  Default values for a قراية فاتحة invitation. Everything here is a
//  fallback — real data merges in on top via bootstrap.js when a
//  /qiraya/<slug> page loads from the server's /data/<slug>.json.
// ============================================================================

export const CONFIG = {
  // Same shape as wedding/engagement so the /create form just works —
  // only the visual layer and the eventType label change.
  couple: {
    groom: "محمد",
    bride: "آية",
    eventType: "قراية فاتحة",
    groomLabel: "العريس",
    brideLabel: "العروس",
  },

  // Optional Quranic verse to display above the invitation body.
  // Set to empty string to hide the whole quote block.
  quote:
    "وَمِنْ آيَاتِهِ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا لِّتَسْكُنُوا إِلَيْهَا وَجَعَلَ بَيْنَكُم مَّوَدَّةً وَرَحْمَةً",
  quoteSource: "الروم ٢١",

  event: {
    datetimeIso: "2026-11-14T19:00:00+02:00",
    welcomeTime: "6:30 م",
    receptionTime: "7:00 م",
    durationHours: 3,
  },

  venue: {
    name: "مسجد السلطان حسن",
    address: "ميدان صلاح الدين، القاهرة",
    mapsEmbedSrc: "https://www.google.com/maps?q=Sultan+Hassan+Mosque+Cairo&output=embed",
    mapsDeepLink: "https://maps.google.com/?q=Sultan+Hassan+Mosque+Cairo",
  },

  // The host family's message to guests. Set via create.html's
  // "Blessing / short message" field.
  blessing:
    "يتشرف أهل العروسين بدعوة حضراتكم لقراية الفاتحة بإذن الله وبركته.",

  gallery: [],
  music: "",
  slug: "demo",

  firebase: {
    apiKey:            "AIzaSyC4r0MZyLlX5c7UdYZ1j1L90vzUmm2A3co",
    authDomain:        "weding-dc92e.firebaseapp.com",
    projectId:         "weding-dc92e",
    storageBucket:     "weding-dc92e.firebasestorage.app",
    messagingSenderId: "645238686194",
    appId:             "1:645238686194:web:c2caf0ebcb31c7cee36b6b",
  },
};
