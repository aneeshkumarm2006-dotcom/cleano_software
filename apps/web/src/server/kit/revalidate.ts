// What a kit change makes stale, in one place (API_V1.md §5, "Invalidation is
// shared"). The paths are exactly the ones the web actions revalidated before
// their logic moved into ./kit.ts and ./issue.ts.
import "server-only";

import { revalidatePath } from "next/cache";

/** A recount, a condition, or an item added: the cleaner's kit and the office's inventory. */
export function revalidateAfterKitChange(): void {
  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/admin/inventory");
}

/** An issue report also moves warehouse stock, which the settings tab shows. */
export function revalidateAfterKitIssue(): void {
  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/settings");
}

export function revalidateAfterRestockRequest(): void {
  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/cleaners/my-inventory/resolve");
  revalidatePath("/admin/inventory");
}

export function revalidateAfterPickup(): void {
  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/cleaners/my-inventory/checkout");
  revalidatePath("/cleaners/my-inventory/history");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/settings");
}
