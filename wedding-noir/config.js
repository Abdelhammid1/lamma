// ============================================================================
//  ALL couple-specific settings live in this one file.
//  Edit here to reuse the site for a different couple / event.
// ============================================================================

export const CONFIG = {
  // ---------- 1. Couple + event type ----------
  couple: {
    groom: "Ahmed",
    bride: "Sara",
    eventType: "Wedding",      // "Wedding" | "Engagement"
    groomLabel: "The Groom",   // shown under the groom's name
    brideLabel: "The Bride",
  },

  // ---------- 2. Event date/time ----------
  //   Full ISO 8601 with timezone offset. The countdown and .ics file both
  //   derive from this single value.
  event: {
    datetimeIso: "2026-10-17T18:00:00+02:00",
    welcomeTime: "5:30 PM",
    receptionTime: "7:00 PM",
    durationHours: 4,
  },

  // ---------- 3. Venue ----------
  venue: {
    name: "Marriott Zamalek",
    address: "16 Saraya El Gezira St, Cairo, Egypt",
    // Paste the src="..." value from Google Maps → Share → Embed a map
    mapsEmbedSrc:
      "https://www.google.com/maps?q=Marriott+Zamalek+Cairo&output=embed",
    // Regular Google Maps URL — mobile browsers open the native maps app
    mapsDeepLink: "https://maps.google.com/?q=Marriott+Zamalek+Cairo",
  },

  // ---------- 4. Dress code ----------
  dressCode: {
    label: "Black tie / cream",
    colors: ["#1a1a1a", "#4a4a4a", "#f5f1ea", "#ebe4d7", "#a84a3a"],
  },

  // ---------- 5. Blessing / message ----------
  blessing:
    "Together with our families, we invite you to share in the quiet joy of our day.",

  // ---------- 6. Media ----------
  gallery: [
    "images/gallery/1.jpg",
    "images/gallery/2.jpg",
    "images/gallery/3.jpg",
    "images/gallery/4.jpg",
    "images/gallery/5.jpg",
    "images/gallery/6.jpg",
  ],
  music: "audio/ambient.mp3",

};
