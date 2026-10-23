// ============================================================================
//  Default values for an engagement invitation. Everything here is a
//  fallback — the real data merges in on top via bootstrap.js when a
//  /engagement/<slug> page loads from the server's /data/<slug>.json.
//  Edit here only to change the "demo" placeholder that renders when
//  no slug resolves.
// ============================================================================

export const CONFIG = {
  // Keep the field names identical to wedding/config.js so the same
  // data schema produced by /create works for both templates — only
  // the visual layer differs.
  couple: {
    groom: "Yousef",
    bride: "Layla",
    eventType: "Engagement",
    groomLabel: "The Groom",
    brideLabel: "The Bride",
  },

  event: {
    datetimeIso: "2026-12-05T19:00:00+02:00",
    welcomeTime: "6:30 PM",
    receptionTime: "7:30 PM",
    durationHours: 3,
  },

  venue: {
    name: "The Nile Ritz-Carlton",
    address: "1113 Corniche El Nil, Cairo, Egypt",
    mapsEmbedSrc: "https://www.google.com/maps?q=Nile+Ritz-Carlton+Cairo&output=embed",
    mapsDeepLink: "https://maps.google.com/?q=Nile+Ritz-Carlton+Cairo",
  },

  dressCode: {
    label: "Soft neutrals · rose, nude, ivory",
    colors: ["#f5e6e3", "#d4a7a0", "#c9a37a", "#f8f2eb"],
  },

  blessing:
    "With joyful hearts, we invite you to celebrate the beginning of our forever. Please come share the evening with us.",

  gallery: [],
  music: "",
  slug: "demo",

};
