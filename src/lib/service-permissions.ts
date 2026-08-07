// Single source of truth for "is this cleaner allowed to work this job?"
// (awerfixes.pdf item 3 — service category permissions per employee).
//
// PURE module — no Prisma client, no `db`, no `next/headers`. It is imported by
// server actions (claimJob, assignCleaners, bulkAssignCleaner), by server
// components (the available-jobs board) AND by client components (the admin
// employee card, the cleaner pickers), so it must stay bundleable everywhere.
// Same constraint `src/lib/availability.ts` documents, for the same reason.
//
// TWO RULES DECIDE EVERYTHING, both settled with the owner:
//
//   1. EMPTY LIST = ALL CATEGORIES ALLOWED (decision 8). Restricting an employee
//      is opt-in, so the migration needed no backfill and no existing cleaner
//      changed behaviour on deploy.
//   2. A JOB WITH NO RESOLVABLE CATEGORY IS VISIBLE TO EVERYONE (fail-open,
//      matching decision 8's stance). Job.jobType is free text carried in from
//      BookingKoala; `normalizeJobType` folds what it recognises and returns
//      null for the rest. Failing CLOSED there would silently hide work from
//      every restricted cleaner the moment an import spelled a service a new
//      way — with no signal to anyone. Failing open costs, at worst, a cleaner
//      seeing one job outside their categories.
//
// Enforcement is asymmetric on purpose: HARD on the cleaner side (the board,
// the preview, the claim), ADVISORY on the admin side. The PDF is explicit that
// an admin assigning outside a cleaner's categories gets a warning and can
// still proceed — nothing in this module may block an admin write.

import {
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_KEYS,
  normalizeJobType,
  type ServiceCategory,
} from "./calendar-labels";

/**
 * The three move keys are ONE permission. SERVICE_CATEGORIES carries
 * MOVE_IN, MOVE_OUT and MOVE_IN_OUT separately and live data contains all
 * three, but a business either does move cleans or it doesn't — an admin who
 * ticked the combined service would otherwise unknowingly block the legacy
 * MOVE_IN / MOVE_OUT jobs. `jobTypeLabel` already folds them the same way when
 * the catalog offers only the combined service.
 */
export const MOVE_FAMILY = ["MOVE_IN", "MOVE_OUT", "MOVE_IN_OUT"] as const;

/** The canonical key the whole move family is stored and compared as. */
export const MOVE_CANONICAL = "MOVE_IN_OUT";

/** Fold a category key onto the key permissions are expressed in. */
export function canonicalPermissionCategory(category: string): string {
  return (MOVE_FAMILY as readonly string[]).includes(category)
    ? MOVE_CANONICAL
    : category;
}

/**
 * The checkbox rows the admin sees — SERVICE_CATEGORIES with the move family
 * collapsed to a single row, so the UI offers 7 meaningful choices instead of 9
 * with three that overlap.
 */
export const PERMISSION_CATEGORIES: ServiceCategory[] = SERVICE_CATEGORIES.filter(
  (c) => c.key !== "MOVE_IN" && c.key !== "MOVE_OUT"
);

/** Human label for a canonical category key. */
export function categoryLabel(category: string): string {
  return (
    PERMISSION_CATEGORIES.find((c) => c.key === category)?.label ??
    SERVICE_CATEGORIES.find((c) => c.key === category)?.label ??
    category
  );
}

/**
 * Clean anything arriving from a form or an action into a valid, deduped,
 * canonical list. EVERY writer goes through this so junk — a renamed service, a
 * hand-crafted POST, a stale client bundle — can never reach the column and
 * quietly lock a cleaner out of work they are approved for.
 */
export function normalizeAllowedCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const key = v.trim().toUpperCase();
    if (!SERVICE_CATEGORY_KEYS.includes(key)) continue;
    const canonical = canonicalPermissionCategory(key);
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}

/**
 * The one question every enforcement point asks. See the two rules at the top of
 * this file for why both "no restriction" and "no category" answer true.
 */
export function isCategoryAllowed(
  jobType: string | null | undefined,
  allowed: string[] | null | undefined
): boolean {
  // Rule 1 — no restriction configured.
  if (!allowed || allowed.length === 0) return true;
  const category = normalizeJobType(jobType);
  // Rule 2 — nothing to gate on.
  if (!category) return true;
  const wanted = canonicalPermissionCategory(category);
  return allowed.some((a) => canonicalPermissionCategory(a) === wanted);
}

/**
 * Warning copy for the ADMIN assignment UIs. Returns null when there is nothing
 * to warn about, so a caller can map over a crew and keep the truthy lines —
 * deliberately the same shape and tone as `availabilityWarning` in
 * src/lib/availability.ts, since the two advisories sit in the same panel.
 */
export function categoryMismatchWarning(
  name: string,
  jobType: string | null | undefined,
  allowed: string[] | null | undefined
): string | null {
  if (isCategoryAllowed(jobType, allowed)) return null;
  const category = normalizeJobType(jobType);
  const label = category ? categoryLabel(canonicalPermissionCategory(category)) : "this";
  return `${name} is not approved for ${label} work`;
}

/** What the cleaner is told when a category rule stops them. */
export const CATEGORY_BLOCKED_MESSAGE =
  "This job isn't in your approved service categories.";
