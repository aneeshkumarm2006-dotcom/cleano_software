"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isCleanerRole } from "@/lib/role-routing";
import { findAssignableProduct } from "@/lib/kit-product.server";

/**
 * Cleaner self-service starting inventory (spec item 15).
 *
 * A new (or imported) cleaner records what they already have on hand — one
 * product at a time — without waiting for an admin to assign a kit. Only
 * touches the cleaner's own `EmployeeProduct` row; master `Product.stockLevel`
 * is untouched (their supplies are already out of the warehouse). Every add is
 * written to the `InventoryChange` audit trail.
 *
 * AUTHZ: employeeId always comes from the session — no IDOR surface.
 */

const MAX_KIT_QUANTITY = 1000;

export async function addMyInventoryItem(input: {
  productId: string;
  quantity: number;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const actor = session.user as { id: string; name?: string; role?: string };
  if (!isCleanerRole(actor.role)) {
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

  // Adding an item creates a NEW kit row, so the catalogue rules apply
  // (Stage 5's shared lookup). Same answer as before for an active product;
  // an archived one now says which product and how to bring it back.
  const lookup = await findAssignableProduct(input.productId);
  if (!lookup.ok) return { success: false, error: lookup.error };
  const product = lookup.product;

  const existing = await db.employeeProduct.findUnique({
    where: {
      employeeId_productId: { employeeId: actor.id, productId: product.id },
    },
    select: { id: true },
  });
  if (existing) {
    return {
      success: false,
      error: "Already in your kit — use Update count instead",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.employeeProduct.create({
      data: { employeeId: actor.id, productId: product.id, quantity: qty },
    });
    await tx.inventoryChange.create({
      data: {
        productId: product.id,
        employeeId: actor.id,
        employeeName: actor.name ?? null,
        quantityChange: qty,
        newQuantity: qty,
        unit: product.unit,
        action: "RECOUNT",
        reason: "Starting inventory set by cleaner",
        changedById: actor.id,
        changedByName: actor.name ?? null,
      },
    });
  });

  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/admin/inventory");
  return { success: true };
}
