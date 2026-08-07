// Checklist drift rules (awerfixes.pdf item 5, round 3).
//
// PURE — no DB imports — so the verify script can exercise the rules directly
// instead of grepping for them. The store half lives in job-checklist.server.ts.
//
// WHY THIS EXISTS: a JobChecklist is a FLATTENED SNAPSHOT. Items are copied out
// of the matching ChecklistTemplates at generation time, so if an admin later
// adds an add-on or changes the job type, the cleaner is looking at a checklist
// for a job that no longer exists. Regenerating unconditionally would throw away
// work the cleaner has already done; never regenerating leaves them following
// the wrong list. The rule below is the small, safe middle: regenerate only
// while nothing has been touched, otherwise keep their progress and say so.

export interface ChecklistItemShape {
  title: string;
  description: string | null;
  isRequired: boolean;
  sortOrder: number;
}

export interface ChecklistItemProgress {
  status: string;
  notes: string | null;
}

/**
 * A stable fingerprint of what a checklist SHOULD contain.
 *
 * Order-insensitive on purpose: `sortOrder` is derived from the template's
 * position in an in-memory filter, so two runs can legitimately number the same
 * items differently without the job having changed at all. Title + required-ness
 * + description is what the cleaner actually reads.
 */
export function checklistSignature(items: ChecklistItemShape[]): string {
  return items
    .map(
      (i) =>
        `${i.title.trim().toLowerCase()}|${i.isRequired ? "R" : "o"}|${(
          i.description ?? ""
        )
          .trim()
          .toLowerCase()}`
    )
    .sort()
    .join("\n");
}

/**
 * True when the cleaner has not engaged with the checklist at all — every item
 * still PENDING and no notes written. Only then is a regeneration lossless.
 *
 * An EMPTY item list counts as untouched: there is nothing to lose.
 */
export function isUntouched(items: ChecklistItemProgress[]): boolean {
  return items.every(
    (i) => i.status === "PENDING" && !(i.notes && i.notes.trim())
  );
}

export type ChecklistAction =
  /** Stored items still match the job — leave them alone. */
  | "KEEP"
  /** The job changed and nothing is lost by rebuilding. */
  | "REGENERATE"
  /** The job changed but the cleaner is mid-way — keep progress, warn them. */
  | "STALE"
  /** The job changed, nothing matches any more, and nothing is lost. */
  | "DISCARD";

/**
 * What to do with an existing checklist given what the job now matches.
 *
 * `expected` is the item set the CURRENT templates produce; `stored` is what the
 * cleaner is holding.
 */
export function resolveChecklistAction(
  stored: (ChecklistItemShape & ChecklistItemProgress)[],
  expected: ChecklistItemShape[]
): ChecklistAction {
  if (checklistSignature(stored) === checklistSignature(expected)) return "KEEP";
  if (!isUntouched(stored)) return "STALE";
  // Untouched from here on, so rebuilding costs the cleaner nothing.
  return expected.length === 0 ? "DISCARD" : "REGENERATE";
}

// ── The clock-out gate ──────────────────────────────────────────────────────
//
// A required item may not be SKIPPED (the panel disables that button) and may
// not be left PENDING at clock-out. This lived as an inline predicate inside the
// clock screen's footer, which is how the OTHER clock-out button — the one on
// the job detail page, and the one most cleaners actually press — ended up with
// no gate at all. One predicate, both buttons.

export function pendingRequiredItems<T extends ChecklistItemProgress & { isRequired: boolean }>(
  items: T[]
): T[] {
  return items.filter((i) => i.isRequired && i.status !== "COMPLETED");
}

/** True when clock-out is allowed. An empty checklist gates nothing. */
export function requiredItemsSatisfied(
  items: (ChecklistItemProgress & { isRequired: boolean })[]
): boolean {
  return pendingRequiredItems(items).length === 0;
}

/** Copy shown beside a disabled clock-out button. */
export const CHECKLIST_GATE_HINT =
  "Complete all required checklist items first";

/** Copy shown when a checklist drifted but the cleaner's progress was kept. */
export const CHECKLIST_STALE_HINT =
  "Job details changed after this checklist was created — some items may be out of date.";

/** Copy shown when no template matches this job at all. */
export const CHECKLIST_NONE_CONFIGURED =
  "No checklist configured for this job type.";
