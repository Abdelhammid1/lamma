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
    label: "Pink dresses",
    colors: ["#f7d9e1", "#efc8d2", "#a13b58", "#c9a86a", "#4a1f2e"],
  },

  // ---------- 5. Blessing / message ----------
  blessing:
    "Together with their families, we joyfully invite you to share in the celebration of our special day.",

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

  // ---------- 7. Firebase project config ----------
  //   Get these values from  Firebase Console → Project Settings → General →
  //   Your apps → Web app → SDK setup and configuration.
  //   Until you paste real values, the site will show a "Firebase not
  //   configured" banner and RSVP + guestbook will be disabled.
  firebase: {
    apiKey:            "AIzaSyC4r0MZyLlX5c7UdYZ1j1L90vzUmm2A3co",
    authDomain:        "weding-dc92e.firebaseapp.com",
    projectId:         "weding-dc92e",
    storageBucket:     "weding-dc92e.firebasestorage.app",
    messagingSenderId: "645238686194",
    appId:             "1:645238686194:web:c2caf0ebcb31c7cee36b6b",
    measurementId:     "G-99C93SS013",
  },
};
