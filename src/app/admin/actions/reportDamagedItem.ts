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
 *
 * Both stock movements (the cleaner's kit AND master stock) are written to
 * `InventoryChange` so cleaner-driven movements land in the product's Stock
 * History audit log, not just in a transient alert.
 *
 * AUTHZ: the kit row is looked up by the SESSION user id — a cleaner can only
 * ever report against their own kit.
 */
export async function reportDamagedItem(input: {
  productId: string;
  quantity?: number;
  reason?: string;
  kind?: "damaged" | "lost";
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const rawQty = Number(input.quantity ?? 1);
  if (!Number.isFinite(rawQty) || rawQty <= 0) {
    return { success: false, error: "Quantity must be greater than zero" };
  }
  const qty = Math.max(1, Math.floor(rawQty));
  const kind = input.kind === "lost" ? "lost" : "damaged";
  const reason = input.reason?.trim().slice(0, 300) ?? "";

  const actor = session.user as { id: string; name?: string };

  const kit = await db.employeeProduct.findUnique({
    where: {
      employeeId_productId: {
        employeeId: actor.id,
        productId: input.productId,
      },
    },
    include: {
      product: { select: { name: true, unit: true, stockLevel: true } },
    },
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

  const newKitQty = kit.quantity - qty;
  const newStockLevel = kit.product.stockLevel - qty;
  const auditReason = `${kind === "damaged" ? "Damaged" : "Lost"} — reported by cleaner${
    reason ? `: ${reason}` : ""
  }`;

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
    // Audit: the cleaner's assigned stock …
    db.inventoryChange.create({
      data: {
        productId: input.productId,
        employeeId: actor.id,
        employeeName: actor.name ?? null,
        quantityChange: -qty,
        newQuantity: newKitQty,
        unit: kit.product.unit,
        reason: auditReason,
        changedById: actor.id,
        changedByName: actor.name ?? null,
      },
    }),
    // … and the matching write-off against master/warehouse stock.
    db.inventoryChange.create({
      data: {
        productId: input.productId,
        employeeId: null,
        employeeName: null,
        quantityChange: -qty,
        newQuantity: newStockLevel,
        unit: kit.product.unit,
        reason: auditReason,
        changedById: actor.id,
        changedByName: actor.name ?? null,
      },
    }),
    // Alert admin to review and reorder.
    db.alert.create({
      data: {
        type: "LOW_INVENTORY",
        severity: "WARNING",
        title: `${kind === "damaged" ? "Damaged" : "Lost"} item: ${kit.product.name}`,
        message: `${actor.name ?? "A cleaner"} reported ${qty} ${kit.product.name} as ${kind}.${
          reason ? ` Reason: ${reason}` : ""
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
