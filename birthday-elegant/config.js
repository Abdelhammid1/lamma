// ============================================================================
//  Birthday — Elegant variant.
//
//  Reads the SAME payload shape the classic /create birthday writes
//  (name, quiz, memories, letterAr, letterEn, signatureEn, signatureAr,
//  videoUrl, musicUrl) but renders a formal single-scroll layout:
//  no quiz, no celebrate screen, no wrong-answer modal. For adult
//  milestones where the playful birthday template feels out of place.
// ============================================================================

export const CONFIG = {
  name:         "Someone",
  dateLabel:    "",            // "Saturday, 14 November 2026" — optional eyebrow
  honorific:    "A Birthday",  // under the cover title

  memories:     [],            // [{url, dateLabel}]
  letterAr:     "",
  letterEn:     "",
  signatureEn:  "With love",
  signatureAr:  "",

  videoUrl:     "",
  musicUrl:     "",

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
