// Reported-status vocabularies for cleaner-held inventory
// (cleano_inventory_operations_fixes.pdf #1 + #4). Stage 2 of `_ai_context/TODO.md`.
//
// A cleaner's kit row reports its state in ONE of three vocabularies, chosen by
// the product's `ItemType`:
//
//   LIQUID                → a level      (Full / Good / Half / Low / Empty)
//   COUNTABLE_CONSUMABLE  → a count judged against the refill threshold
//   REUSABLE_EQUIPMENT    → a CONDITION  (Available / Missing / Damaged /
//                                         Needs replacement / Needs maintenance)
//
// The condition vocabulary is the one that fixes PDF #4: a scraper is not
// "low" when a cleaner holds exactly one — one scraper is the correct number.
// It is either there and working, or it is a problem an admin should see.
//
// PURE — no DB, no framework imports. The Prisma enums (`EquipmentCondition`,
// `LiquidLevel`, `InventoryFlagType`) are mirrored here as string unions rather
// than imported, for the same reason `item-type.ts` mirrors `ItemType`: client
// components, server actions and one-off scripts all need this vocabulary and
// none of them should have to pull in the generated client to get it. The
// mirrors are asserted against the schema by
// `scripts/verify-stage2-inventory-logic.ts`.

/* ───────────────────────────── equipment condition ───────────────────────── */

/** Conditions, in the order they are offered to a cleaner. */
export const EQUIPMENT_CONDITIONS = [
  "AVAILABLE",
  "MISSING",
  "DAMAGED",
  "NEEDS_REPLACEMENT",
  "NEEDS_MAINTENANCE",
] as const;

export type EquipmentCondition = (typeof EQUIPMENT_CONDITIONS)[number];

/**
 * What an equipment row means when nobody has reported on it yet.
 *
 * `EmployeeProduct.condition` is deliberately nullable — "never reported" is a
 * real state — but a tool sitting in a cleaner's kit with no report against it
 * is, as far as anyone knows, fine. It must NOT read as a problem, or the
 * "needs attention" count is inflated the moment the column ships (which is the
 * exact defect PDF #4 describes, just with a different label).
 */
export const DEFAULT_EQUIPMENT_CONDITION: EquipmentCondition = "AVAILABLE";

export const EQUIPMENT_CONDITION_LABEL: Record<EquipmentCondition, string> = {
  AVAILABLE: "Available",
  MISSING: "Missing",
  DAMAGED: "Damaged",
  NEEDS_REPLACEMENT: "Needs replacement",
  NEEDS_MAINTENANCE: "Needs maintenance",
};

/** Short hint under each option, so the right one gets picked. */
export const EQUIPMENT_CONDITION_HINT: Record<EquipmentCondition, string> = {
  AVAILABLE: "Have it, works fine",
  MISSING: "Can't find it",
  DAMAGED: "Broken or unusable",
  NEEDS_REPLACEMENT: "Worn out, past its life",
  NEEDS_MAINTENANCE: "Works, but needs a service",
};

export function isEquipmentCondition(v: unknown): v is EquipmentCondition {
  return (
    typeof v === "string" &&
    (EQUIPMENT_CONDITIONS as readonly string[]).includes(v)
  );
}

/** Parse an untrusted value (form field, CSV cell, API body). */
export function parseEquipmentCondition(
  v: unknown,
  fallback: EquipmentCondition = DEFAULT_EQUIPMENT_CONDITION
): EquipmentCondition {
  return isEquipmentCondition(v) ? v : fallback;
}

/** Anything other than AVAILABLE is something an admin should look at. */
export function conditionNeedsAttention(c: EquipmentCondition): boolean {
  return c !== "AVAILABLE";
}

/* ─────────────────────────────── liquid level ────────────────────────────── */

/** Levels, fullest first — the order the pills are rendered in. */
export const LIQUID_LEVELS = ["FULL", "GOOD", "HALF", "LOW", "EMPTY"] as const;

export type LiquidLevel = (typeof LIQUID_LEVELS)[number];

export const LIQUID_LEVEL_LABEL: Record<LiquidLevel, string> = {
  FULL: "Full",
  GOOD: "Good",
  HALF: "Half",
  LOW: "Low",
  EMPTY: "Empty",
};

export function isLiquidLevel(v: unknown): v is LiquidLevel {
  return (
    typeof v === "string" && (LIQUID_LEVELS as readonly string[]).includes(v)
  );
}

/** A reported level that means "this cleaner needs more of it". */
export function levelNeedsAttention(l: LiquidLevel): boolean {
  return l === "LOW" || l === "EMPTY";
}

/* ─────────────────────────── countable status ────────────────────────────── */

/**
 * What a cleaner can say about a COUNTABLE_CONSUMABLE beyond the number.
 *
 * The count answers "how many", which is most of it — but not all of it. A box
 * of gloves that is nowhere to be found, or a pack that arrived split open, is
 * neither "5" nor "0", and the closing report has to be able to say so
 * (PDF #2: "mark items that are low, empty, missing or damaged").
 *
 * Deliberately NOT persisted on `EmployeeProduct`: for a countable the QUANTITY
 * is the state of record, and inventing a second column that could disagree
 * with it is exactly the kind of drift Stage 4 exists to clean up. The status
 * decides which admin flag is raised and is written to the history row's
 * `newStatus`; the kit row keeps its number.
 */
export const COUNTABLE_STATUSES = [
  "OK",
  "LOW",
  "EMPTY",
  "MISSING",
  "DAMAGED",
] as const;

export type CountableStatus = (typeof COUNTABLE_STATUSES)[number];

export const COUNTABLE_STATUS_LABEL: Record<CountableStatus, string> = {
  OK: "OK",
  LOW: "Low",
  EMPTY: "Empty",
  MISSING: "Missing",
  DAMAGED: "Damaged",
};

export const COUNTABLE_STATUS_HINT: Record<CountableStatus, string> = {
  OK: "Enough for the next job",
  LOW: "Nearly out",
  EMPTY: "None left",
  MISSING: "Can't find it",
  DAMAGED: "Unusable",
};

export function isCountableStatus(v: unknown): v is CountableStatus {
  return (
    typeof v === "string" &&
    (COUNTABLE_STATUSES as readonly string[]).includes(v)
  );
}

/* ────────────────────────────── admin review flag ────────────────────────── */

export const INVENTORY_FLAG_TYPES = [
  "LOW",
  "EMPTY",
  "MISSING",
  "DAMAGED",
  "NEEDS_REPLACEMENT",
  "NEEDS_MAINTENANCE",
  "RESTOCK",
] as const;

export type InventoryFlagType = (typeof INVENTORY_FLAG_TYPES)[number];

export function isInventoryFlagType(v: unknown): v is InventoryFlagType {
  return (
    typeof v === "string" &&
    (INVENTORY_FLAG_TYPES as readonly string[]).includes(v)
  );
}

export const INVENTORY_FLAG_LABEL: Record<InventoryFlagType, string> = {
  LOW: "Running low",
  EMPTY: "Empty",
  MISSING: "Missing",
  DAMAGED: "Damaged",
  NEEDS_REPLACEMENT: "Needs replacement",
  NEEDS_MAINTENANCE: "Needs maintenance",
  RESTOCK: "Restock requested",
};

/** Where a flag was raised from. Mirrors `InventoryFlag.source`. */
export const INVENTORY_FLAG_SOURCES = [
  "CLOCK_OUT",
  "RECOUNT",
  "ISSUE_REPORT",
  "ADMIN",
] as const;

export type InventoryFlagSource = (typeof INVENTORY_FLAG_SOURCES)[number];

/**
 * The admin review flag a reported condition raises, or `null` when the
 * condition is not a problem.
 *
 * One mapping, used by every writer (the cleaner's condition update, the issue
 * report, and — from Stage 3 — clock-out), so the same condition can never open
 * two differently-typed flags depending on which screen it came from.
 */
export function conditionFlagType(
  c: EquipmentCondition
): InventoryFlagType | null {
  switch (c) {
    case "AVAILABLE":
      return null;
    case "MISSING":
      return "MISSING";
    case "DAMAGED":
      return "DAMAGED";
    case "NEEDS_REPLACEMENT":
      return "NEEDS_REPLACEMENT";
    case "NEEDS_MAINTENANCE":
      return "NEEDS_MAINTENANCE";
  }
}

/**
 * The flag a reported LIQUID level raises, or `null` when the bottle is fine.
 *
 * HALF is deliberately not a problem: half a bottle is a working bottle, and
 * flagging it would refill the admin queue with exactly the noise PDF #4
 * complains about on the cleaner's side.
 */
export function levelFlagType(l: LiquidLevel): InventoryFlagType | null {
  switch (l) {
    case "FULL":
    case "GOOD":
    case "HALF":
      return null;
    case "LOW":
      return "LOW";
    case "EMPTY":
      return "EMPTY";
  }
}

/** The flag a reported COUNTABLE status raises, or `null` when it is fine. */
export function countableStatusFlagType(
  s: CountableStatus
): InventoryFlagType | null {
  switch (s) {
    case "OK":
      return null;
    case "LOW":
      return "LOW";
    case "EMPTY":
      return "EMPTY";
    case "MISSING":
      return "MISSING";
    case "DAMAGED":
      return "DAMAGED";
  }
}

/**
 * Human label for any status string this module knows, whatever its vocabulary.
 *
 * `InventoryChange.previousStatus`/`newStatus` are free text because one table
 * logs all three vocabularies, so the reader gets a bare value and has to work
 * out which one it belongs to. The overlapping values (LOW, EMPTY, MISSING,
 * DAMAGED) carry the SAME label in every vocabulary that has them, so the order
 * of these lookups cannot change what an admin reads.
 */
export function statusLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isEquipmentCondition(value)) return EQUIPMENT_CONDITION_LABEL[value];
  if (isLiquidLevel(value)) return LIQUID_LEVEL_LABEL[value];
  if (isCountableStatus(value)) return COUNTABLE_STATUS_LABEL[value];
  return value;
}
