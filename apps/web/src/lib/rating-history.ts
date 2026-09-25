// Where a cleaner's rating came from, and what an admin is allowed to see.
//
// Sept 17 list, item 13. The admin profile showed a bare list of stars and
// notes, so "why is she on 4.2?" could not be answered from the screen: a
// four-star customer review and a four-star correction an admin typed in after
// a complaint were the same row.
//
// Client-safe and pure. The admin page renders these on the server and the
// controls beside them run in the browser, so the rule that decides what a row
// SAYS has to be usable from both.

/**
 * The `ratedBy` markers the two customer rating paths write: the emailed link
 * (`/rate/[token]`) and the signed-in portal. Anything else in that column is a
 * user id, which means a person in the office typed it.
 *
 * Exported because a PUBLIC surface has to be able to ask "did a customer
 * really write this?" of a row whose `source` column is NULL, and guessing
 * wrong there publishes an internal note.
 */
export const CUSTOMER_RATED_BY = ["client-link", "client-portal"] as const;

/** ADMIN: an admin typed it in. CUSTOMER: a job review. IMPORTED: pre-dates us. */
export type RatingSource = "ADMIN" | "CUSTOMER" | "IMPORTED";

export interface RatingSourceInput {
  source?: string | null;
  jobId?: string | null;
  ratedBy?: string | null;
}

/**
 * The source of one rating.
 *
 * `source` is authoritative when it is set. It is NULL on every row written
 * before the column existed, and those are read rather than backfilled:
 *
 *   • a rating attached to a JOB came from that job's customer;
 *   • a rating with no job but with `ratedBy` was typed in by that admin;
 *   • a rating with neither came in with the BookingKoala import.
 *
 * Deriving beats backfilling here because the derivation is exactly the rule a
 * backfill would have used, and getting it wrong in bulk on live rows is worse
 * than getting it wrong on one screen.
 */
export function ratingSource(r: RatingSourceInput): RatingSource {
  if (r.source === "ADMIN" || r.source === "CUSTOMER" || r.source === "IMPORTED") {
    return r.source;
  }
  if (r.ratedBy && (CUSTOMER_RATED_BY as readonly string[]).includes(r.ratedBy)) {
    return "CUSTOMER";
  }
  if (r.ratedBy) return "ADMIN";
  return r.jobId ? "CUSTOMER" : "IMPORTED";
}

/** What the admin sees on the row. */
export function ratingSourceLabel(source: RatingSource): string {
  switch (source) {
    case "ADMIN":
      return "Admin rating";
    case "CUSTOMER":
      return "Customer review";
    case "IMPORTED":
      return "Imported";
  }
}

/**
 * Is this note for the office only?
 *
 * The PDF is explicit: "customer-facing users should not see internal admin
 * rating notes." An admin's note is a reason written for colleagues — "gave
 * her the benefit of the doubt after the Dorval complaint" — and it is on the
 * same table as the comment a customer left, which IS shown back to people.
 *
 * So the question is answered here, once, rather than each surface deciding.
 * A surface that cannot call this must send no notes at all.
 */
export function isInternalNote(r: RatingSourceInput): boolean {
  return ratingSource(r) !== "CUSTOMER";
}

export const RATING_NOTE_MAX = 500;

/**
 * An admin's rating must be a number in range, rounded the way every other
 * rating in the app is.
 *
 * Returns the value to store, or the reason it cannot be stored. Pure, so the
 * form can refuse before posting and the action can refuse again — the action
 * being the one that counts.
 */
export function normaliseAdminRating(
  raw: unknown,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false; error: string } {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) {
    return { ok: false, error: "Enter a rating between 1.0 and 5.0." };
  }
  if (n < min || n > max) {
    return { ok: false, error: `A rating has to be between ${min} and ${max}.` };
  }
  return { ok: true, value: Math.round(n * 10) / 10 };
}
