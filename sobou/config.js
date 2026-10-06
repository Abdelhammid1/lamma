// ============================================================================
//  Default values for a سبوع invitation. The schema deliberately reuses
//  the `couple` shape from the other templates so no backend change is
//  needed — just repurposed:
//
//    couple.groom  → baby's name (displayed as the hero)
//    couple.bride  → parents' names (e.g. "محمد و نور")
//
//  Everything else (event, venue, blessing) means the same thing.
// ============================================================================

export const CONFIG = {
  couple: {
    groom: "يوسف",
    bride: "محمد و نور",         // "<father> و <mother>" works best
    eventType: "سبوع",
    groomLabel: "المولود",
    brideLabel: "الأهل",
  },

  event: {
    datetimeIso: "2026-11-21T18:00:00+02:00",
    welcomeTime: "٥:٠٠ م",
    receptionTime: "٦:٠٠ م",
    durationHours: 3,
  },

  venue: {
    name: "منزل العائلة",
    address: "القاهرة",
    mapsEmbedSrc: "",
    mapsDeepLink: "",
  },

  blessing:
    "بشرى ونور دخلوا بيتنا. يسعدنا نشارككم فرحة سبوع صغيرنا، وتدعوا له بالصحة والحياة الطيبة.",

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
