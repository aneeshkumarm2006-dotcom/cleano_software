/**
 * Sanitize a job's free-text notes for CLEANER-facing display (item 10:
 * "cleaners cannot see the total booking value").
 *
 * The live BookingKoala importer already keeps price out of notes (add-ons
 * only; billing goes to an admin-only log). But legacy imported jobs still hold
 * machine-generated billing lines in `Job.notes` ("Final amount CAD: …",
 * "Provider/team: …", "Source Booking ID: …", "Tax CAD: …", "$217.31"), and
 * notes are free text an admin could paste anything into. This strips any line
 * that looks like billing/traceability or contains a dollar amount, then
 * returns what's left — the genuine customer instructions — or null.
 *
 * Deliberately errs toward hiding: a real instruction that happens to contain
 * "$" is rare, and never showing a price is the requirement.
 */
const BILLING_LINE = new RegExp(
  [
    "source booking id",
    "transaction id",
    "imported from bookingkoala",
    "provider/team",
    "final amount",
    "service total",
    "sub ?total",
    "amount paid",
    "tax\\b",
    "\\bcad\\b",
    "payment method",
    "occurrence",
    "created on",
    "discount(ed)? total",
    "charge",
    "\\$\\s?\\d", // any dollar figure
  ].join("|"),
  "i"
);

export function sanitizeCleanerNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const kept = notes
    .split(/\r?\n|(?<=\S)\s*\|\s*(?=\S)/) // split on newlines OR " | " separators
    .map((s) => s.trim())
    .filter((line) => line && !BILLING_LINE.test(line));
  const out = kept.join("\n").trim();
  return out || null;
}
