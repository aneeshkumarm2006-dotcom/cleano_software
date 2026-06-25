"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Cleaner reports a damaged or lost item from their personal kit.
 * Deducts from BOTH the cleaner's `EmployeeProduct.quantity` and the
 * master `Product.stockLevel`, and raises an admin alert so ops can
 * review and reorder if needed.
 *
 * Quantity defaults to 1 (most common case). Reason is optional but
 * recommended — it shows up directly in the admin alert.
 */
export async function reportDamagedItem(input: {
  productId: string;
  quantity?: number;
  reason?: string;
  kind?: "damaged" | "lost";
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const qty = Math.max(1, input.quantity ?? 1);
  const kind = input.kind ?? "damaged";

  const kit = await db.employeeProduct.findUnique({
    where: {
      employeeId_productId: {
        employeeId: session.user.id,
        productId: input.productId,
      },
    },
    include: { product: { select: { name: true, stockLevel: true } } },
  });
  if (!kit) {
    return { success: false, error: "This item is not in your kit" };
  }
  if (kit.quantity < qty) {
    return {
      success: false,
      error: `You only have ${kit.quantity} of this item in your kit`,
    };
  }

  await db.$transaction([
    // Reduce the cleaner's personal kit count.
    db.employeeProduct.update({
      where: { id: kit.id },
      data: { quantity: { decrement: qty } },
    }),
    // Reduce the master inventory level.
    db.product.update({
      where: { id: input.productId },
      data: { stockLevel: { decrement: qty } },
    }),
    // Alert admin to review and reorder.
    db.alert.create({
      data: {
        type: "LOW_INVENTORY",
        severity: "WARNING",
        title: `${kind === "damaged" ? "Damaged" : "Lost"} item: ${kit.product.name}`,
        message: `${session.user.name ?? "A cleaner"} reported ${qty} ${kit.product.name} as ${kind}.${
          input.reason?.trim() ? ` Reason: ${input.reason.trim()}` : ""
        } Master stock and the cleaner's kit have both been decremented.`,
        relatedId: input.productId,
        relatedType: "Product",
      },
    }),
  ]);

  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/admin/inventory");
  return { success: true };
}
