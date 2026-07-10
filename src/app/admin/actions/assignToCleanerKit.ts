"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Admin action: add a quantity of a product to a cleaner's personal kit.
 *
 * Per the inventory rules, master `Product.stockLevel` does NOT decrement
 * when items are assigned to a cleaner's kit. Master only decrements when
 * the cleaner reports an item damaged or lost (see reportDamagedItem.ts).
 */
export async function assignToCleanerKit(input: {
  cleanerId: string;
  productId: string;
  quantity: number;
  notes?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  const qty = Math.max(0, input.quantity);
  if (qty === 0) {
    return { success: false, error: "Quantity must be > 0" };
  }

  const product = await db.product.findUnique({
    where: { id: input.productId },
    select: { id: true, name: true, unit: true },
  });
  if (!product) return { success: false, error: "Product not found" };

  const cleaner = await db.user.findUnique({
    where: { id: input.cleanerId },
    select: { id: true, name: true, role: true },
  });
  if (!cleaner) return { success: false, error: "Cleaner not found" };

  const actor = session.user as { id?: string; name?: string };

  await db.$transaction(async (tx) => {
    const updated = await tx.employeeProduct.upsert({
      where: {
        employeeId_productId: {
          employeeId: input.cleanerId,
          productId: input.productId,
        },
      },
      create: {
        employeeId: input.cleanerId,
        productId: input.productId,
        quantity: qty,
        notes: input.notes?.trim() || null,
      },
      update: {
        quantity: { increment: qty },
        ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      },
    });

    await tx.inventoryChange.create({
      data: {
        productId: input.productId,
        employeeId: cleaner.id,
        employeeName: cleaner.name,
        quantityChange: qty,
        newQuantity: updated.quantity,
        unit: product.unit,
        reason: input.notes?.trim() || "Assigned to cleaner kit",
        changedById: actor.id ?? null,
        changedByName: actor.name ?? null,
      },
    });
  });

  revalidatePath("/admin/inventory");
  revalidatePath("/cleaners/my-inventory");
  revalidatePath(`/admin/employees/${input.cleanerId}`);
  return { success: true };
}

/**
 * Admin action: remove a quantity from a cleaner's kit without touching
 * master stock. Used when re-allocating between cleaners or correcting
 * data. (For damaged/lost reductions, see reportDamagedItem.)
 */
export async function removeFromCleanerKit(input: {
  cleanerId: string;
  productId: string;
  quantity: number;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  const qty = Math.max(0, input.quantity);
  if (qty === 0) return { success: false, error: "Quantity must be > 0" };

  const kit = await db.employeeProduct.findUnique({
    where: {
      employeeId_productId: {
        employeeId: input.cleanerId,
        productId: input.productId,
      },
    },
    include: {
      product: { select: { unit: true } },
      employee: { select: { id: true, name: true } },
    },
  });
  if (!kit) return { success: false, error: "Cleaner does not have this item" };
  if (kit.quantity < qty) {
    return {
      success: false,
      error: `Cleaner only has ${kit.quantity} of this item`,
    };
  }

  const actor = session.user as { id?: string; name?: string };
  const newQuantity = kit.quantity - qty;

  await db.$transaction(async (tx) => {
    if (newQuantity === 0) {
      await tx.employeeProduct.delete({ where: { id: kit.id } });
    } else {
      await tx.employeeProduct.update({
        where: { id: kit.id },
        data: { quantity: { decrement: qty } },
      });
    }

    await tx.inventoryChange.create({
      data: {
        productId: input.productId,
        employeeId: kit.employee.id,
        employeeName: kit.employee.name,
        quantityChange: -qty,
        newQuantity,
        unit: kit.product.unit,
        reason: "Removed from cleaner kit",
        changedById: actor.id ?? null,
        changedByName: actor.name ?? null,
      },
    });
  });

  revalidatePath("/admin/inventory");
  revalidatePath("/cleaners/my-inventory");
  revalidatePath(`/admin/employees/${input.cleanerId}`);
  return { success: true };
}
