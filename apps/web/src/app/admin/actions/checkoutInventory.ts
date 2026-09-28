"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isStaffRole } from "@/lib/role-routing";
import { actorFromSession } from "@/server/actor";
import { pickUp } from "@/server/kit/kit";
import { revalidateAfterPickup } from "@/server/kit/revalidate";

interface CheckoutInventoryInput {
  locationId: string;
  notes?: string;
  items: { productId: string; quantity: number }[];
}

/**
 * A cleaner takes items from a storage location into their kit. The rules
 * (one transaction; the location's row and `stockLevel` move together through
 * adjustWarehouseStock; short stock warns and never blocks, fix list item 5)
 * live in server/kit/kit.ts (pickUp), shared with the phone's
 * POST /api/v1/kit/pickups.
 */
export async function checkoutInventory(input: CheckoutInventoryInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }
  const user = session.user as { id: string; name?: string | null; email: string; role?: string | null };
  if (!isStaffRole(user.role)) {
    return { success: false, error: "Not authorized" };
  }

  if (!input?.locationId) {
    return { success: false, error: "Location is required" };
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { success: false, error: "Cart is empty" };
  }

  try {
    const res = await pickUp(actorFromSession(user), {
      locationId: input.locationId,
      items: input.items,
      note: typeof input.notes === "string" ? input.notes : null,
    });
    if (!res.ok) return { success: false, error: res.message };

    revalidateAfterPickup();

    // `warnings` is non-empty when the locker went low/negative. The pickup
    // still succeeded — the UI shows these for information and the admin
    // inventory view flags the negative rows for reconciliation.
    return { success: true, checkoutId: res.value.pickupId, warnings: res.value.warnings };
  } catch (error: unknown) {
    // The detail stays in the server log; the person gets a plain sentence.
    console.error("Error during checkout:", error);
    return { success: false, error: "Checkout failed. Try again." };
  }
}
