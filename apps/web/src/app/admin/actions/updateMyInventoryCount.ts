"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isCleanerRole } from "@/lib/role-routing";
import { actorFromSession } from "@/server/actor";
import { MAX_KIT_QUANTITY, setKitCount } from "@/server/kit/kit";
import { revalidateAfterKitChange } from "@/server/kit/revalidate";

/**
 * Cleaner self-service stock correction.
 *
 * A cleaner recounts an item in their own kit and saves the true number
 * (e.g. "the bottle was half empty when I got it"). This ONLY touches the
 * cleaner's `EmployeeProduct.quantity` — master `Product.stockLevel` is left
 * alone, matching assignToCleanerKit/removeFromCleanerKit: master stock only
 * moves on damage/loss (reportDamagedItem) or warehouse fulfilment.
 *
 * Every correction writes an `InventoryChange` audit row so the movement shows
 * up in the product's Stock History on the admin side — a cleaner cannot move
 * their own numbers silently. The rules live in server/kit/kit.ts
 * (setKitCount), shared with the phone's PUT /api/v1/kit/items/:id/count.
 *
 * AUTHZ: the caller may only ever edit a row keyed to their OWN session user
 * id. The employeeId is taken from the session, never from client input, so
 * there is no IDOR surface here (no cleaner can pass someone else's id).
 */
export async function updateMyInventoryCount(input: {
  productId: string;
  quantity: number;
  reason?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const user = session.user as { id: string; name?: string | null; email: string; role?: string | null };

  // Fail closed: this is a cleaner-only self-service path. Admins have their
  // own audited flows (assignToCleanerKit / removeFromCleanerKit).
  if (!isCleanerRole(user.role)) {
    return { success: false, error: "Not authorized" };
  }

  if (typeof input.productId !== "string" || input.productId.length === 0) {
    return { success: false, error: "Invalid item" };
  }

  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty < 0 || qty > MAX_KIT_QUANTITY) {
    return {
      success: false,
      error: `Enter a count between 0 and ${MAX_KIT_QUANTITY}`,
    };
  }
  // Kit counts are whole units in every UI we expose; reject fractions rather
  // than silently rounding a cleaner's number.
  if (!Number.isInteger(qty)) {
    return { success: false, error: "Enter a whole number" };
  }

  const res = await setKitCount(actorFromSession(user), {
    productId: input.productId,
    quantity: qty,
    reason: typeof input.reason === "string" ? input.reason : "",
  });
  if (!res.ok) return { success: false, error: res.message };

  if (res.value.changed) revalidateAfterKitChange();
  return { success: true, quantity: qty };
}
