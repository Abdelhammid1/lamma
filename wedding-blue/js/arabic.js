// ============================================================================
//  Arabic numbers, dates and times, the way Egyptian printed invitations
//  write them: Eastern Arabic digits, Gregorian month names, 12-hour time
//  with ص / م — "الأحد ١٢ ديسمبر ٢٠٢٧ · ٧:٠٠ م".
// ============================================================================

const LOCALE = "ar-EG";
const num = new Intl.NumberFormat(LOCALE, { useGrouping: false });

// 1234 → "١٢٣٤"
export const ar = (n) => num.format(n);

// Any Western digits in a string → Arabic digits ("12:30" → "١٢:٣٠").
export const arDigits = (s) => String(s).replace(/[0-9]/g, (d) => ar(+d));

// "19:00" → "٧:٠٠ م"; anything that isn't HH:MM comes back with Arabic digits.
export function arTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
  if (!m) return arDigits(String(t || "").trim());
  const h = +m[1];
  return `${ar(h % 12 || 12)}:${arDigits(m[2])} ${h >= 12 ? "م" : "ص"}`;
}

// Parts of a date: { dow: "الأحد", day: "١٢", month: "ديسمبر", year: "٢٠٢٧", time: "٧:٠٠ م" }
export function arDate(d) {
  const f = (opts) => new Intl.DateTimeFormat(LOCALE, opts).format(d);
  return {
    dow: f({ weekday: "long" }),
    day: ar(d.getDate()),
    month: f({ month: "long" }),
    year: ar(d.getFullYear()),
    time: arTime(`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`),
  };
}
