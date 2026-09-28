"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isCleanerRole } from "@/lib/role-routing";
import { actorFromSession } from "@/server/actor";
import { addKitItem, MAX_KIT_QUANTITY } from "@/server/kit/kit";
import { revalidateAfterKitChange } from "@/server/kit/revalidate";

/**
 * Cleaner self-service starting inventory (spec item 15).
 *
 * A new (or imported) cleaner records what they already have on hand — one
 * product at a time — without waiting for an admin to assign a kit. Only
 * touches the cleaner's own `EmployeeProduct` row; master `Product.stockLevel`
 * is untouched (their supplies are already out of the warehouse). Every add is
 * written to the `InventoryChange` audit trail.
 *
 * The rules live in server/kit/kit.ts (addKitItem), shared with the phone's
 * POST /api/v1/kit/items. This is the web's adapter: its gate, its messages.
 *
 * AUTHZ: employeeId always comes from the session — no IDOR surface.
 */
export async function addMyInventoryItem(input: {
  productId: string;
  quantity: number;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const user = session.user as { id: string; name?: string | null; email: string; role?: string | null };
  if (!isCleanerRole(user.role)) {
    return { success: false, error: "Not authorized" };
  }

  if (typeof input.productId !== "string" || input.productId.length === 0) {
    return { success: false, error: "Pick a product" };
  }
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_KIT_QUANTITY) {
    return {
      success: false,
      error: `Enter a quantity between 1 and ${MAX_KIT_QUANTITY}`,
    };
  }
  if (!Number.isInteger(qty)) {
    return { success: false, error: "Enter a whole number" };
  }

  const res = await addKitItem(actorFromSession(user), { productId: input.productId, quantity: qty });
  if (!res.ok) return { success: false, error: res.message };

  revalidateAfterKitChange();
  return { success: true };
}
