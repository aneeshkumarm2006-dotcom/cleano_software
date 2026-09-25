"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { setLocationQuantity } from "@/lib/stock.server";

interface SetLocationStockInput {
  locationId: string;
  productId: string;
  quantity: number;
}

/**
 * Settings → Inventory Locations → Manage Stock.
 *
 * This action used to write the location row and NOTHING else, which is half of
 * the 8-vs-0 bug on p.5 of the PDF: an admin restocked here, the locker showed
 * 8, `Product.stockLevel` stayed at 0, and every pending request then refused
 * to be approved with "Only 0 in warehouse". It now goes through
 * `setLocationQuantity`, which recomputes the cache and writes the audit row in
 * one transaction (Stage 4).
 */
export async function setLocationStock(input: SetLocationStockInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    if (input.quantity < 0) {
      return { success: false, error: "Quantity cannot be negative" };
    }

    const actor = session.user as { id?: string; name?: string };

    await db.$transaction(async (tx) => {
      const location = await tx.inventoryLocation.findUnique({
        where: { id: input.locationId },
        select: { name: true },
      });
      await setLocationQuantity(tx, {
        productId: input.productId,
        locationId: input.locationId,
        quantity: input.quantity,
        action: "ADMIN_SET",
        reason: `Stock count set at ${location?.name ?? "location"}`,
        actor,
      });
    }, {
      // `setLocationQuantity` is five sequential queries on its own (read the
      // row, upsert it, SUM every location, write the cache, write the audit
      // row) and this adds the location lookup. Supabase round-trips push that
      // past Prisma's default 5s window, and the transaction dies mid-way with
      // P2028 — which is how a Manage Stock save could return 200 and persist
      // nothing.
      maxWait: 10_000,
      timeout: 30_000,
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/inventory");
    revalidatePath("/cleaners/my-inventory");
    return { success: true };
  } catch (error) {
    console.error("Error setting location stock:", error);
    return { success: false, error: "Failed to update stock" };
  }
}
