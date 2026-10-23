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

};
