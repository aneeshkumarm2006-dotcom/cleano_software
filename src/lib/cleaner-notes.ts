/**
 * Two rules for the same vocabulary, because hiding and DELETING are different
 * jobs.
 *
 * `BILLING_LINE` (display) errs toward HIDING: showing a price to a cleaner is
 * the thing we must never do, and a render is reversible, so an over-hide costs
 * nothing permanent.
 *
 * `BILLING_SEGMENT_STRICT` (the one-way DB cleanup, awerfixes item 15) errs
 * toward KEEPING: `scripts/cleanupImportNotes.ts` rewrites `Job.notes` on live
 * rows and only a JobLog copy stands behind it, so a false positive destroys a
 * real customer instruction. It is therefore anchored on a `label:value` shape
 * with an explicit label list, which cannot match prose.
 *
 * Both split on the same separators, so a "line" means the same thing to each.
 */

/**
 * The shared vocabulary, as a regex source string.
 *
 * Exported so `scripts/probe-awer-fixes-3.ts` can build its Postgres regex from
 * the same list instead of keeping a third hand-maintained copy that silently
 * drifts. (Importing a string is not a database write, so the read-only probe
 * guard in verify-awer-fixes-3.ts is unaffected.)
 */
export const BILLING_LINE_SOURCE = [
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
  // Was a bare "charge", which also killed "recharge", "surcharge" and
  // "charger". Bounded so a genuine instruction survives.
  "\\bcharges?\\b",
  // Any dollar figure. Deliberately broad for DISPLAY — note that it also hides
  // an "Add-ons: …" line whose add-on name happens to carry a price. Accepted:
  // never showing a cleaner a number beats showing the right add-on name.
  "\\$\\s?\\d",
].join("|");

const BILLING_LINE = new RegExp(BILLING_LINE_SOURCE, "i");

/**
 * The DESTRUCTIVE rule — label-anchored, and much narrower.
 *
 * Matches only a `Label: value` (or `Label = value`) segment whose label is one
 * of the machine-generated ones a BookingKoala import wrote. The
 * `[^:=]{0,12}` gap is what lets a unit sit between label and colon, which the
 * live rows need: `"Final amount CAD: 208.52"`.
 *
 * What it CANNOT match, structurally rather than by luck:
 *   • `"Add-ons: Inside Fridge"`  — "add-ons" is not in the label list, and
 *     item 9 requires that line to survive the cleanup.
 *   • `"Gate code 4455, dog is friendly"` — no label:value shape at all.
 *   • `"Please recharge the vacuum"` / `"Surcharge waived"` — "charge" and a
 *     bare `$N` are deliberately ABSENT here, unlike the display rule.
 */
export const BILLING_SEGMENT_STRICT = new RegExp(
  // Optional machine-generated qualifier. The live rows carry "Original payment
  // method: CC" on all 205 of them, which the bare label list missed because it
  // anchors at the segment start. Kept to an explicit word rather than a
  // wildcard prefix: `.{0,20}` here would let "Please note the tax:" through,
  // which is exactly the prose this rule must never touch.
  "^\\s*(?:original\\s+)?(?:" +
    [
      "source booking id",
      "transaction id",
      "imported from bookingkoala",
      "provider/team",
      "final amount",
      "service total",
      "sub ?total",
      "amount paid",
      "refunded amount",
      "discount(?:ed)? total",
      "discount amount",
      "tip",
      "parking",
      "tax",
      "gst",
      "qst",
      "payment method",
      "occurrence",
      "created on",
      "booking id",
      "frequency",
    ].join("|") +
    ")\\b[^:=]{0,12}[:=]",
  "i"
);

/** Newlines, or a " | " separator between two non-space characters. */
const SEGMENT_SPLIT = /\r?\n|(?<=\S)\s*\|\s*(?=\S)/;

/**
 * Sanitize a job's free-text notes for CLEANER- and CUSTOMER-facing display
 * (item 10: "cleaners cannot see the total booking value").
 *
 * The live BookingKoala importer already keeps price out of notes (add-ons
 * only; billing goes to an admin-only log). But legacy imported jobs still hold
 * machine-generated billing lines in `Job.notes` ("Final amount CAD: …",
 * "Provider/team: …", "Tax CAD: …", "$217.31"), and notes are free text an
 * admin could paste anything into.
 */
export function sanitizeCleanerNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const kept = notes
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter((line) => line && !BILLING_LINE.test(line));
  const out = kept.join("\n").trim();
  return out || null;
}

/**
 * Does this note actually contain a machine-generated billing segment?
 *
 * The cleanup script selects on THIS, not on `strip(notes) !== notes`. Those
 * are not the same question: splitting and rejoining also normalises CRLF to
 * LF, so a comparison would flag every note written on Windows as "changed" and
 * rewrite rows that have nothing wrong with them. Asking the real question
 * keeps a one-way write down to the rows that need it.
 */
export function hasBillingSegments(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return notes
    .split(SEGMENT_SPLIT)
    .some((line) => BILLING_SEGMENT_STRICT.test(line.trim()));
}

/**
 * Strip ONLY machine-generated billing segments, keeping everything else.
 *
 * This is the rule `scripts/cleanupImportNotes.ts` writes to the database with.
 * It lives here, as a pure function, specifically so it can be exercised
 * against real note shapes BEFORE it ever meets a live row — the script itself
 * is then a thin database wrapper with no judgement of its own.
 *
 * Returns null when nothing survives, so the caller can null the column.
 */
export function stripBillingSegments(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const kept = notes
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter((line) => line && !BILLING_SEGMENT_STRICT.test(line));
  const out = kept.join("\n").trim();
  return out || null;
}
