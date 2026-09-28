"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { normalizeIssueType, type InventoryIssueType } from "@bookmops/core/inventory";
import { isStaffRole } from "@/lib/role-routing";
import { actorFromSession } from "@/server/actor";
import { reportKitIssue } from "@/server/kit/issue";
import { revalidateAfterKitIssue } from "@/server/kit/revalidate";

/**
 * Cleaner reports an inventory issue against their own kit
 * (awer_fixes.pdf item 15): product, issue type, quantity and an optional note.
 *
 * Issue types are Lost, Broken, Ran out and Other. They are NOT equivalent:
 * only genuine loss (Lost/Broken) is written off against company stock. "Ran
 * out" is normal consumption and "Other" is unexplained, so both adjust the
 * kit and alert an admin rather than quietly reducing what the company
 * believes it owns. See packages/core/src/inventory/inventory-issues.ts.
 *
 * The rules live in server/kit/issue.ts, shared with the phone's
 * POST /api/v1/kit/items/:id/issues. Two are stricter than this action used
 * to be, because the API contract requires them of both front doors:
 *   - the kit comes down by a conditional decrement, so two reports at once
 *     can't both spend the same stock;
 *   - a write-off against company stock is capped at what the office issued
 *     to this cleaner, and stock that already left a location at a pickup is
 *     never taken off it again. Anything past the cap comes off the kit only,
 *     and the alert asks the office to review it.
 *
 * AUTHZ: the kit row is looked up by the SESSION user id — a cleaner can only
 * ever report against their own kit.
 */
export async function reportDamagedItem(input: {
  productId: string;
  quantity?: number;
  reason?: string;
  /** "LOST" | "BROKEN" | "RAN_OUT" | "OTHER". Legacy "damaged"/"lost" accepted. */
  kind?: InventoryIssueType | "damaged" | "lost";
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const user = session.user as { id: string; name?: string | null; email: string; role?: string | null };
  if (!isStaffRole(user.role)) {
    return { success: false, error: "Not authorized" };
  }
  if (typeof input.productId !== "string" || !input.productId) {
    return { success: false, error: "This item is not in your kit" };
  }

  const rawQty = Number(input.quantity ?? 1);
  if (!Number.isFinite(rawQty) || rawQty <= 0) {
    return { success: false, error: "Quantity must be greater than zero" };
  }
  const qty = Math.max(1, Math.floor(rawQty));

  const res = await reportKitIssue(actorFromSession(user), {
    productId: input.productId,
    type: normalizeIssueType(input.kind),
    quantity: qty,
    note: typeof input.reason === "string" ? input.reason : null,
    now: new Date(),
  });
  if (!res.ok) return { success: false, error: res.message };

  revalidateAfterKitIssue();
  return { success: true };
}
