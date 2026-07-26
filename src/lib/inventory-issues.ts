// Cleaner inventory issue reporting (awer_fixes.pdf item 15).
//
// The four issue types do NOT all mean the same thing to the books, and that
// distinction is the whole point of having types rather than a free-text note:
//
//   LOST / BROKEN  — the product no longer exists. It is written off against
//                    company stock as well as the cleaner's kit.
//   RAN_OUT        — the product was CONSUMED doing the job. Company stock was
//                    already reduced when it was handed over, so writing it off
//                    again would double-count the loss. Kit only.
//   OTHER          — unspecified. Reduce the kit so the count is honest, but
//                    never silently write off company stock for a reason nobody
//                    has stated; it is flagged for admin instead.
//
// PURE — no DB imports — so the cleaner UI and the server action agree.

export const INVENTORY_ISSUE_TYPES = [
  "LOST",
  "BROKEN",
  "RAN_OUT",
  "OTHER",
] as const;

export type InventoryIssueType = (typeof INVENTORY_ISSUE_TYPES)[number];

export const ISSUE_LABEL: Record<InventoryIssueType, string> = {
  LOST: "Lost",
  BROKEN: "Broken",
  RAN_OUT: "Ran out",
  OTHER: "Other",
};

/** Short hint shown under each option so cleaners pick the right one. */
export const ISSUE_HINT: Record<InventoryIssueType, string> = {
  LOST: "Can't find it",
  BROKEN: "Damaged, unusable",
  RAN_OUT: "Used it all up",
  OTHER: "Something else",
};

export function isInventoryIssueType(v: unknown): v is InventoryIssueType {
  return (
    typeof v === "string" &&
    (INVENTORY_ISSUE_TYPES as readonly string[]).includes(v)
  );
}

/**
 * Does this issue write the quantity off against COMPANY stock as well as the
 * cleaner's kit?
 *
 * Only genuine loss does. "Ran out" is normal consumption and "Other" is
 * unexplained — neither should quietly reduce what the company believes it owns.
 */
export function writesOffCompanyStock(type: InventoryIssueType): boolean {
  return type === "LOST" || type === "BROKEN";
}

/** Issues that mean the cleaner needs replacements, not that stock vanished. */
export function needsRestock(type: InventoryIssueType): boolean {
  return type === "RAN_OUT";
}

/** Audit-trail reason line, shared by the kit and warehouse rows. */
export function issueAuditReason(
  type: InventoryIssueType,
  note?: string | null
): string {
  const base = `${ISSUE_LABEL[type]} — reported by cleaner`;
  const trimmed = note?.trim();
  return trimmed ? `${base}: ${trimmed}` : base;
}

/**
 * Legacy `kind` values from the previous damaged/lost-only action, so older
 * callers and any stored strings still resolve to a real type.
 */
export function normalizeIssueType(raw: unknown): InventoryIssueType {
  if (isInventoryIssueType(raw)) return raw;
  if (raw === "lost") return "LOST";
  if (raw === "damaged") return "BROKEN";
  return "OTHER";
}
