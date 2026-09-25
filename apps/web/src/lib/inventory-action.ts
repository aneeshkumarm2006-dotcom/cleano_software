// What an `InventoryChange` row RECORDS — the verb, stored rather than guessed
// (cleano_inventory_operations_fixes.pdf #1/#2, Stage 3 of `_ai_context/TODO.md`).
//
// WHY THIS EXISTS
// ---------------
// The activity log used to work out what a row meant by pattern-matching its
// `reason` sentence: `r.startsWith("warehouse pickup")`, `r.includes("handed
// to")`, `r.startsWith("assigned via kit")`. That is brittle in the one way
// that matters — the strings live in eleven different action files, and
// rewording any of them silently reclassified history. A row that said
// "Assigned from Main Warehouse" became "Adjusted" the day someone changed the
// copy to "Issued from Main Warehouse".
//
// `InventoryChange.action` is written by the actor that performs the movement,
// so the verb is decided by the code that knows the answer instead of by a
// regex reading prose afterwards.
//
// LEGACY ROWS
// -----------
// The column is nullable ON PURPOSE. Every row written before Stage 3's
// migration has no action, and back-filling one by re-running the same
// pattern-match we are trying to retire would bake today's guess into the
// record permanently. Old rows keep their prose and are labelled by
// `legacyActionLabel()` at read time, clearly marked as derived.
//
// PURE — no DB, no framework imports — so the server actions, the activity
// reader and the verify script all share one vocabulary.

/** Every verb an inventory movement can be recorded under. */
export const INVENTORY_ACTIONS = [
  /** A cleaner recounted what is actually in their kit. */
  "RECOUNT",
  /** A status/level/condition report that moved no quantity. */
  "STATUS_REPORT",
  /** Admin assigned stock to a cleaner (single, bulk or kit template). */
  "ASSIGN",
  /** A cleaner collected stock from a warehouse/locker location. */
  "PICKUP",
  /** Admin set a number outright — warehouse stock or a cleaner's count. */
  "ADMIN_SET",
  /** Reported at clock-out against a job (Stage 3's closing report). */
  "JOB_REPORT",
  /** A refill/equipment request was approved and fulfilled. */
  "REQUEST_FULFILLED",
  /** A cleaner reported the item lost, broken, run out or "other". */
  "ISSUE",
  /** Written by a CSV import. */
  "IMPORT",
] as const;

export type InventoryAction = (typeof INVENTORY_ACTIONS)[number];

/** Short, scannable verb for the activity log. */
export const INVENTORY_ACTION_LABEL: Record<InventoryAction, string> = {
  RECOUNT: "Recount",
  STATUS_REPORT: "Status report",
  ASSIGN: "Assigned",
  PICKUP: "Pickup",
  ADMIN_SET: "Set by admin",
  JOB_REPORT: "Reported at clock-out",
  REQUEST_FULFILLED: "Request fulfilled",
  ISSUE: "Issue reported",
  IMPORT: "Imported",
};

export function isInventoryAction(v: unknown): v is InventoryAction {
  return (
    typeof v === "string" && (INVENTORY_ACTIONS as readonly string[]).includes(v)
  );
}

/**
 * The verb for a row written BEFORE the action column existed.
 *
 * This is the old `deriveAction()` from `getInventoryActivity.ts`, moved here
 * unchanged in behaviour and renamed for what it is: a best-effort reading of a
 * sentence, used only where there is nothing better. New rows never reach it.
 *
 * One addition — TODO decision D4. Rows whose reason starts "Used on job" are
 * the estimated Light/Medium/Heavy deductions Stage 3 deleted; they are the one
 * legacy shape whose NUMBER is untrustworthy rather than merely unlabelled, so
 * they say so.
 */
export function legacyActionLabel(
  reason: string | null,
  isCompanyStock: boolean
): string {
  const r = (reason ?? "").toLowerCase();
  if (r.startsWith("warehouse pickup")) return "Pickup";
  if (r.includes("handed to")) return "Handed out";
  if (r.startsWith("assigned from")) return "Assigned";
  if (r.startsWith("assigned via kit") || r.startsWith('kit "')) return "Kit assigned";
  if (r.startsWith("manual adjustment")) return "Manual adjust";
  // Cleaner-reported issues (item 15). "damaged" is the legacy wording that
  // pre-dates the four typed issues, kept so old rows still label correctly.
  if (r.startsWith("broken")) return "Reported broken";
  if (r.startsWith("damaged")) return "Reported damaged";
  if (r.startsWith("lost")) return "Reported lost";
  if (r.startsWith("ran out")) return "Ran out";
  if (r.startsWith("other —") || r.startsWith("other -")) return "Issue reported";
  // D4: the estimated-usage rows. Labelled for what they were, so nobody reads
  // a millilitre figure nobody ever measured as a count somebody took.
  if (r.startsWith("used on job")) return "Legacy estimated usage";
  if (r.includes("request")) return "Request fulfilled";
  if (r.includes("stock count") || r.includes("count")) return "Stock count";
  return isCompanyStock ? "Company stock" : "Adjusted";
}

/**
 * The label for one activity row: the stored verb when there is one, the
 * derived reading when there is not.
 */
export function activityActionLabel(
  action: string | null | undefined,
  reason: string | null,
  isCompanyStock: boolean
): string {
  if (isInventoryAction(action)) return INVENTORY_ACTION_LABEL[action];
  return legacyActionLabel(reason, isCompanyStock);
}
