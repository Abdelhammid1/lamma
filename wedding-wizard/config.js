// ============================================================================
//  Wedding · Wizard — demo content. A published invitation replaces these
//  values with its own /data/<slug>.json (see js/bootstrap.js).
// ============================================================================

export const CONFIG = {
  couple: {
    groom: "Omar",
    bride: "Esraa",
    eventType: "Wedding",
    groomLabel: "The Groom",
    brideLabel: "The Bride",
  },

  event: {
    datetimeIso: "2026-11-06T15:00:00+02:00",
    welcomeTime: "14:00",
    receptionTime: "",
    durationHours: 5,
  },

  venue: {
    name: "The Great Hall",
    address: "Cairo, Egypt",
    mapsEmbedSrc: "",
    mapsDeepLink: "",
  },

  // The letter's first lines. Empty → the template's own wording.
  blessing: "",

  dressCode: {
    label: "Your own style is already perfect, but wearing some light colors will match our vibes more.",
    colors: ["#efd27a", "#eea7b0", "#a9cbe6", "#c4aee2", "#a9dcc0"],
    // Optional "Kindly note" under the colours.
    note: "Just for their safety, keep children away from the dance floor.",
  },

  schedule: [
    { time: "14:00", label: "Welcome" },
    { time: "15:00", label: "The Entrance" },
    { time: "17:00", label: "Drinks & Snacks" },
    { time: "18:00", label: "Photos" },
  ],

  contacts: [],
  music: "",

  // The clip that opens every invitation (candle-lit desk, the letter
  // arrives and opens), as a site path. Empty → the intro shows the castle
  // and "Tap anywhere to begin the magic".
  introVideo: "/wedding-wizard/media/intro.mp4",
};
