"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOwnerAdmin } from "@/lib/action-guards";

/**
 * Admin action: SET a cleaner's on-hand count for one product to an absolute
 * value (a stock count / correction), and record the delta in the InventoryChange
 * audit trail inside the same transaction.
 *
 * Deliberately separate from assignToCleanerKit / removeFromCleanerKit, which are
 * DELTA-based ("give them 2 more"). Overloading those with a "set to N" mode is
 * how audit trails end up lying — here `quantityChange` is always derived from
 * the row we just read, so the history and the count can't drift.
 *
 * Per the inventory rules, master `Product.stockLevel` does NOT move when a
 * cleaner's kit count changes. Master only decrements on damage/loss
 * (reportDamagedItem.ts).
 *
 * OWNER/ADMIN only.
 */

// Guards against a fat-fingered "999999999" wiping out a sane inventory value.
const MAX_QUANTITY = 100_000;

export async function setCleanerProductQuantity(input: {
  cleanerId: string;
  productId: string;
  /** Absolute new on-hand count (NOT a delta). 0 removes the item from the kit. */
  quantity: number;
  reason?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const session = await auth.api.getSession({ headers: await headers() });
  const actor = session?.user as { id?: string; name?: string } | undefined;

  // ── Validate input (reject by default) ────────────────────────────────────
  const cleanerId = typeof input?.cleanerId === "string" ? input.cleanerId.trim() : "";
  const productId = typeof input?.productId === "string" ? input.productId.trim() : "";
  if (!cleanerId || !productId) {
    return { success: false, error: "Missing cleaner or product." };
  }

  const quantity = Number(input?.quantity);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
    return {
      success: false,
      error: `Enter a quantity between 0 and ${MAX_QUANTITY}.`,
    };
  }
  // Fractional units are legitimate (0.5 L), but pin the precision so the audit
  // trail doesn't store float noise.
  const newQuantity = Math.round(quantity * 100) / 100;

  const reason =
    typeof input?.reason === "string"
      ? input.reason.trim().slice(0, 500) || null
      : null;

  // ── Resolve + authorize the targets ──────────────────────────────────────
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, unit: true },
  });
  if (!product) return { success: false, error: "Product not found." };

  // Only staff hold field inventory. Blocks pointing a kit row at a CLIENT
  // (imported customer) account or an archived user.
  const cleaner = await db.user.findFirst({
    where: {
      id: cleanerId,
      deletedAt: null,
      role: { in: ["EMPLOYEE", "FIELD_LEAD", "OPS_MANAGER", "ADMIN", "OWNER"] },
    },
    select: { id: true, name: true },
  });
  if (!cleaner) return { success: false, error: "Cleaner not found." };

  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.employeeProduct.findUnique({
        where: {
          employeeId_productId: { employeeId: cleaner.id, productId: product.id },
        },
        select: { id: true, quantity: true },
      });
      const previous = existing?.quantity ?? 0;

      if (newQuantity === 0) {
        if (existing) {
          await tx.employeeProduct.delete({ where: { id: existing.id } });
        }
      } else if (existing) {
        await tx.employeeProduct.update({
          where: { id: existing.id },
          data: { quantity: newQuantity },
        });
      } else {
        await tx.employeeProduct.create({
          data: {
            employeeId: cleaner.id,
            productId: product.id,
            quantity: newQuantity,
          },
        });
      }

      // No-op edits (same number re-submitted) don't pollute the audit trail.
      if (previous === newQuantity) return;

      await tx.inventoryChange.create({
        data: {
          productId: product.id,
          employeeId: cleaner.id,
          employeeName: cleaner.name,
          quantityChange: newQuantity - previous,
          newQuantity,
          unit: product.unit,
          reason: reason ?? "Count set by admin",
          changedById: actor?.id ?? null,
          changedByName: actor?.name ?? null,
        },
      });
    });
  } catch (e) {
    // Detail to the server log only; the client gets a generic message.
    console.error("setCleanerProductQuantity", e);
    return { success: false, error: "Could not update this cleaner's inventory." };
  }

  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/inventory/${product.id}`);
  revalidatePath(`/admin/employees/${cleaner.id}`);
  revalidatePath("/cleaners/my-inventory");
  return { success: true };
}
