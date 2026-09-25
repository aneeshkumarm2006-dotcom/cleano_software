// Server-side companion to `inventory-thresholds.ts` (Stage 2 of
// `_ai_context/TODO.md`, PDF #4 "admin and cleaner must agree").
//
// WHY THIS FILE EXISTS
//
// `cleanerRestockThreshold()` takes an optional `defaultThreshold` — the admin's
// `inventory.defaultRefillThreshold` setting (default 2). Exactly ONE surface
// used to pass it (the cleaner's own My Inventory page). Every admin surface
// omitted it and silently fell through to the built-in floor of 1, so with the
// setting on its default a cleaner holding 2 bottles saw "Low" while the admin
// looking at the same kit saw "OK" — same rule, two different answers, and no
// error anywhere to explain it.
//
// The fix is to make the setting read trivial rather than optional. Any server
// component or action that judges a kit awaits this once and threads the number
// into the pure rule. `getSetting` caches for 30s, so the extra read costs
// nothing per render.
//
// Keep this OUT of `inventory-thresholds.ts`: that module is imported by client
// components, and it must stay free of the db.

import { getSetting } from "@/lib/settings";

/**
 * The admin's global fallback refill threshold, for products with no
 * `cleanerRestockThreshold` of their own.
 *
 * Falls back to the registry default on any read failure (see `getSetting`), so
 * this never resolves to 0 — a 0 threshold means "warn only once they're
 * completely empty", which is what the whole setting exists to prevent.
 */
export function loadCleanerThresholdDefault(): Promise<number> {
  return getSetting("inventory.defaultRefillThreshold");
}
