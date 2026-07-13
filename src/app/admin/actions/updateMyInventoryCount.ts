"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isCleanerRole } from "@/lib/role-routing";

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
 * their own numbers silently.
 *
 * AUTHZ: the caller may only ever edit a row keyed to their OWN session user
 * id. The employeeId is taken from the session, never from client input, so
 * there is no IDOR surface here (no cleaner can pass someone else's id).
 */

/** Guardrail: a self-reported kit count above this is a typo, not a recount. */
const MAX_KIT_QUANTITY = 1000;
const MAX_REASON_LEN = 300;

export async function updateMyInventoryCount(input: {
  productId: string;
  quantity: number;
  reason?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const actor = session.user as { id: string; name?: string; role?: string };

  // Fail closed: this is a cleaner-only self-service path. Admins have their
  // own audited flows (assignToCleanerKit / removeFromCleanerKit).
  if (!isCleanerRole(actor.role)) {
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

  const reason = input.reason?.trim().slice(0, MAX_REASON_LEN) || "";
  if (!reason) {
    return { success: false, error: "Add a short reason for the correction" };
  }

  // Scoped to the session user: a cleaner can only ever load THEIR OWN row.
  const kit = await db.employeeProduct.findUnique({
    where: {
      employeeId_productId: {
        employeeId: actor.id,
        productId: input.productId,
      },
    },
    include: { product: { select: { unit: true } } },
  });
  if (!kit) {
    return { success: false, error: "This item is not in your kit" };
  }

  const delta = qty - kit.quantity;
  if (delta === 0) {
    // Idempotent: saving the same number twice is a no-op, not a second
    // audit row.
    return { success: true, quantity: qty };
  }

  await db.$transaction(async (tx) => {
    await tx.employeeProduct.update({
      where: { id: kit.id },
      data: { quantity: qty },
    });

    await tx.inventoryChange.create({
      data: {
        productId: kit.productId,
        employeeId: actor.id,
        employeeName: actor.name ?? null,
        quantityChange: delta,
        newQuantity: qty,
        unit: kit.product.unit,
        reason: `Cleaner recount: ${reason}`,
        changedById: actor.id,
        changedByName: actor.name ?? null,
      },
    });
  });

  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/admin/inventory");
  return { success: true, quantity: qty };
}
