// One rule for "how many units does this kit edit take out?" (Stage 5 of
// `_ai_context/TODO.md`, cleano_inventory_operations_fixes.pdf #6).
//
// It decides three things that must agree or the admin is misled:
//
//   • whether the "Return removed units to warehouse" checkbox is offered at all
//     (`CleanerInventoryView`, `EmployeeDetailView`),
//   • the number that checkbox promises to move,
//   • the number `setCleanerProductQuantity` actually puts back on the shelf.
//
// The editors hold the quantity field as a STRING — an empty box is not zero,
// and a half-typed "-" is not a removal — so this parses rather than assuming.
//
// PURE — no DB, no framework imports — because two of the three callers are
// client components and the third is a server action.

/**
 * Units this edit removes from the kit. `0` when the count is unchanged, rising,
 * or not yet a usable number.
 *
 * Rounded to 2dp like every other quantity in the inventory code: fractional
 * units are legitimate (0.5 L) but float noise in an audit row is not.
 */
export function unitsRemovedFromKit(
  next: number | string,
  current: number
): number {
  const value =
    typeof next === "string"
      ? next.trim() === ""
        ? Number.NaN
        : Number(next)
      : next;
  if (!Number.isFinite(value) || value < 0) return 0;
  const removed = Math.round((current - value) * 100) / 100;
  return removed > 0 ? removed : 0;
}
