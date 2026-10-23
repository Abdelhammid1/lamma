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

};
