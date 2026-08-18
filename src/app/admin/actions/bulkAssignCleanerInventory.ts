"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOwnerAdmin } from "@/lib/action-guards";
import {
  resolveAssignedQuantity,
  type AssignMode as AssignModeType,
} from "@/lib/inventory-assign";
import { adjustWarehouseStock } from "@/lib/stock.server";

/**
 * Quick-assign inventory to ONE cleaner, many products at a time
 * (awer_fixes.pdf items 6 + 13).
 *
 * Two modes, deliberately distinct because they mean different things to the
 * books — overloading one action with both is how stock audits start lying:
 *
 *   • FROM_LOCKER   — "I am handing them this much." `quantity` is an AMOUNT TO
 *     GIVE. It is added to the cleaner's kit AND subtracted from company stock
 *     (the chosen location's row and the global `Product.stockLevel`).
 *
 *   • MANUAL_ADJUST — "their kit actually holds this much." `quantity` is the
 *     cleaner's NEW ABSOLUTE COUNT. Company stock is untouched, because nothing
 *     physically moved — this is a stock count / correction.
 *
 * Every line writes an InventoryChange row (one for the kit, plus one for the
 * warehouse in FROM_LOCKER mode) so the activity log and each product's Stock
 * History stay truthful.
 *
 * Low or zero locker stock never blocks the assignment — consistent with the
 * decision in item 5. Stock is allowed to go negative and is flagged for
 * reconciliation in the admin inventory view.
 *
 * OWNER/ADMIN only.
 */

export type AssignMode = AssignModeType;

export interface BulkAssignInput {
  cleanerId: string;
  mode: AssignMode;
  /** Required for FROM_LOCKER — which company location the stock leaves. */
  locationId?: string | null;
  /** Only lines the admin actually filled in. */
  items: { productId: string; quantity: number }[];
  notes?: string;
}

export type BulkAssignResult =
  | { success: true; updated: number; warnings: string[] }
  | { success: false; error: string };

// Same fat-finger guard as setCleanerProductQuantity.
const MAX_QUANTITY = 100_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function bulkAssignCleanerInventory(
  input: BulkAssignInput
): Promise<BulkAssignResult> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const session = await auth.api.getSession({ headers: await headers() });
  const actor = session?.user as { id?: string; name?: string } | undefined;

  // ── Validate (reject by default) ──────────────────────────────────────────
  const cleanerId =
    typeof input?.cleanerId === "string" ? input.cleanerId.trim() : "";
  if (!cleanerId) return { success: false, error: "Select a cleaner." };

  const mode: AssignMode =
    input?.mode === "FROM_LOCKER" ? "FROM_LOCKER" : "MANUAL_ADJUST";

  const rawItems = Array.isArray(input?.items) ? input.items : [];
  const items = rawItems
    .filter((i) => i && typeof i.productId === "string")
    .map((i) => ({ productId: i.productId.trim(), quantity: Number(i.quantity) }))
    .filter((i) => i.productId.length > 0 && Number.isFinite(i.quantity));

  if (items.length === 0) {
    return { success: false, error: "Enter a quantity for at least one product." };
  }
  if (items.some((i) => i.quantity < 0 || i.quantity > MAX_QUANTITY)) {
    return {
      success: false,
      error: `Quantities must be between 0 and ${MAX_QUANTITY}.`,
    };
  }
  // FROM_LOCKER moves stock, so a zero line is a no-op rather than a correction.
  if (mode === "FROM_LOCKER" && items.every((i) => i.quantity === 0)) {
    return { success: false, error: "Enter a quantity greater than zero to hand out." };
  }
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.productId)) {
      return { success: false, error: "The same product was listed twice." };
    }
    seen.add(i.productId);
  }

  const notes =
    typeof input?.notes === "string"
      ? input.notes.trim().slice(0, 500) || null
      : null;

  // ── Resolve + authorize targets ───────────────────────────────────────────
  // Only staff hold field inventory — blocks pointing a kit at an imported
  // CLIENT account or an archived user.
  const cleaner = await db.user.findFirst({
    where: {
      id: cleanerId,
      deletedAt: null,
      role: { in: ["EMPLOYEE", "FIELD_LEAD", "OPS_MANAGER", "ADMIN", "OWNER"] },
    },
    select: { id: true, name: true },
  });
  if (!cleaner) return { success: false, error: "Cleaner not found." };

  const products = await db.product.findMany({
    where: { id: { in: items.map((i) => i.productId) }, deletedAt: null },
    select: { id: true, name: true, unit: true, stockLevel: true },
  });
  if (products.length !== items.length) {
    return { success: false, error: "One or more products no longer exist." };
  }
  const productById = new Map(products.map((p) => [p.id, p]));

  let location: { id: string; name: string } | null = null;
  if (mode === "FROM_LOCKER") {
    const locationId =
      typeof input?.locationId === "string" ? input.locationId.trim() : "";
    if (!locationId) {
      return { success: false, error: "Choose the location the stock comes from." };
    }
    location = await db.inventoryLocation.findFirst({
      where: { id: locationId, isActive: true },
      select: { id: true, name: true },
    });
    if (!location) return { success: false, error: "Location not found." };
  }

  const actionable =
    mode === "FROM_LOCKER" ? items.filter((i) => i.quantity > 0) : items;

  try {
    const warnings: string[] = [];

    await db.$transaction(
      async (tx) => {
        for (const item of actionable) {
          const product = productById.get(item.productId)!;

          const existing = await tx.employeeProduct.findUnique({
            where: {
              employeeId_productId: {
                employeeId: cleanerId,
                productId: item.productId,
              },
            },
            select: { quantity: true },
          });
          const before = existing?.quantity ?? 0;

          // The delta recorded in the audit trail is always derived from the row
          // we just read, so history and count cannot drift apart.
          const { after, delta } = resolveAssignedQuantity(
            mode,
            before,
            item.quantity
          );

          if (after === 0 && existing) {
            await tx.employeeProduct.delete({
              where: {
                employeeId_productId: {
                  employeeId: cleanerId,
                  productId: item.productId,
                },
              },
            });
          } else if (after !== 0) {
            await tx.employeeProduct.upsert({
              where: {
                employeeId_productId: {
                  employeeId: cleanerId,
                  productId: item.productId,
                },
              },
              update: { quantity: after },
              create: {
                employeeId: cleanerId,
                productId: item.productId,
                quantity: after,
              },
            });
          }

          const reasonBase =
            mode === "FROM_LOCKER"
              ? `Assigned from ${location!.name}`
              : "Manual adjustment (stock count)";

          await tx.inventoryChange.create({
            data: {
              productId: item.productId,
              employeeId: cleanerId,
              employeeName: cleaner.name ?? null,
              quantityChange: delta,
              newQuantity: after,
              unit: product.unit,
              // FROM_LOCKER hands stock over; the other mode is an admin
              // correcting a number, which is a different verb.
              action: mode === "FROM_LOCKER" ? "ASSIGN" : "ADMIN_SET",
              reason: notes ? `${reasonBase} — ${notes}` : reasonBase,
              changedById: actor?.id ?? null,
              changedByName: actor?.name ?? null,
            },
          });

          // Company stock moves ONLY in FROM_LOCKER mode.
          if (mode === "FROM_LOCKER") {
            // Stage 4: the locker row, `Product.stockLevel` and the warehouse
            // audit row are now one call. Writing them by hand here was fine
            // while this action was the only writer that bothered — it wasn't,
            // and the ones that didn't are what made the p.5 numbers disagree.
            const moved = await adjustWarehouseStock(tx, {
              productId: item.productId,
              locationId: location!.id,
              delta: -item.quantity,
              action: "ASSIGN",
              unit: product.unit,
              reason: `Handed to ${cleaner.name ?? "cleaner"} — ${location!.name}`,
              actor,
            });

            // A short locker warns and reconciles later rather than blocking
            // the hand-out (the decision in item 5).
            if (moved.locationQuantity < 0) {
              warnings.push(
                `${product.name}: ${location!.name} will show ${moved.locationQuantity} ${product.unit} — flagged for reconciliation.`
              );
            }
          }
        }
      },
      // Each line runs several sequential queries; Supabase round-trips make the
      // default 5s window easy to blow past on a bulk save.
      { maxWait: 10_000, timeout: 30_000 }
    );

    revalidatePath("/admin/inventory");
    revalidatePath(`/admin/employees/${cleanerId}`);
    revalidatePath("/cleaners/my-inventory");
    revalidatePath("/admin/settings");

    return { success: true, updated: actionable.length, warnings };
  } catch (error) {
    console.error("bulkAssignCleanerInventory failed", error);
    return { success: false, error: "Could not save the assignment. Nothing was changed." };
  }
}
