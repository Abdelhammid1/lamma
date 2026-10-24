// ============================================================================
//  Wedding · Burgundy — demo content. A published invitation replaces
//  these values with its own /data/<slug>.json (see js/bootstrap.js).
// ============================================================================

export const CONFIG = {
  couple: {
    groom: "Omar",
    bride: "Laila",
    // Optional full names for the ceremony card; fall back to the short ones.
    groomFull: "Omar Hassan",
    brideFull: "Laila Mahmoud",
    eventType: "Wedding",
    groomLabel: "The Groom",
    brideLabel: "The Bride",
  },

  // One line (or two, separated by a line break) per family.
  families: {
    groom: "Mr. & Mrs.\nHassan Abdelrahman",
    bride: "Mr. & Mrs.\nMahmoud Farouk",
  },

  event: {
    datetimeIso: "2027-06-21T18:00:00+02:00",
    welcomeTime: "17:00",
    receptionTime: "19:30",
    durationHours: 5,
  },

  // Where the ceremony happens, if it's somewhere other than the venue.
  ceremony: {
    name: "The Garden Chapel",
  },

  venue: {
    name: "Royal Palace Hall",
    address: "Corniche El Nil, Cairo",
    mapsEmbedSrc: "",
    mapsDeepLink: "",
  },

  blessing: "Please join us as we celebrate the beginning of our life together",

  dressCode: {
    label: "Party Attire",
    colors: ["#4a2f1a", "#6e5640", "#e6cdb6"],
  },

  schedule: [
    { time: "17:30", label: "Guests arrive and are seated" },
    { time: "18:00", label: "Ceremony and vows" },
    { time: "19:30", label: "Reception and dinner" },
    { time: "21:00", label: "Cutting of the cake" },
    { time: "21:30", label: "First dance" },
  ],

  contacts: [],

  gift: {
    message: "Your presence would be the greatest gift we could receive!",
    details: "",
  },

  gallery: [
    "images/demo-1.svg",
    "images/demo-2.svg",
    "images/demo-3.svg",
  ],
  music: "",
};
