"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOwnerAdmin } from "@/lib/action-guards";
import {
  KIT_ROW_MISSING,
  findAssignableProduct,
  type KitProduct,
} from "@/lib/kit-product.server";
import { adjustWarehouseStock, ensureDefaultLocationId } from "@/lib/stock.server";

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
 * ────────────────────────────────────────────────────────────────────────────
 * TWO THINGS STAGE 5 CHANGED (PDF #6, p.6)
 *
 * 1. THE TARGET IS THE KIT ROW, NOT THE CATALOGUE. This action used to resolve
 *    the product with `{ id, deletedAt: null }`, so editing a kit row whose
 *    product had been archived failed with **"Product not found."** — the exact
 *    error in the p.6 screenshot, for a product visible on screen. An existing
 *    assignment is now looked up through `EmployeeProduct`, and an archived
 *    product is perfectly editable and removable there. Only a NEW assignment
 *    consults the catalogue, where archived is (still) refused.
 *
 * 2. WAREHOUSE STOCK MOVES ONLY IF ASKED. The PDF: *"Warehouse stock should not
 *    be affected unless admin specifically chooses to return the item to
 *    warehouse."* Default OFF, unchanged behaviour. With `returnToWarehouse` on
 *    and the count going DOWN, the removed units go back on the shelf through
 *    the Stage 4 helper — location row, `Product.stockLevel` and a second audit
 *    row, in this same transaction. Increases never take stock out: handing
 *    supplies out is `bulkAssignCleanerInventory`'s FROM_LOCKER mode, which
 *    records which location they left.
 *
 * OWNER/ADMIN only.
 */

// Guards against a fat-fingered "999999999" wiping out a sane inventory value.
const MAX_QUANTITY = 100_000;

export interface SetCleanerProductQuantityResult {
  success: true;
  /** Present only when units were actually put back on a shelf. */
  returned?: {
    quantity: number;
    unit: string;
    locationName: string;
    /** Warehouse total afterwards, so the caller can report it honestly. */
    stockLevel: number;
  };
}

export async function setCleanerProductQuantity(input: {
  cleanerId: string;
  productId: string;
  /** Absolute new on-hand count (NOT a delta). 0 removes the item from the kit. */
  quantity: number;
  reason?: string;
  /**
   * Put the units this edit removes back into warehouse stock. Default false —
   * a kit correction is a correction, not a physical movement.
   */
  returnToWarehouse?: boolean;
}): Promise<SetCleanerProductQuantityResult | { success: false; error: string }> {
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

  const wantsReturn = input?.returnToWarehouse === true;

  // ── Resolve + authorize the targets ──────────────────────────────────────
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

  // The kit row IS the authority for an edit. `deletedAt` is not filtered here
  // on purpose — see the header note. This read is for validation and messaging;
  // the transaction re-reads the row for the number it writes.
  const kitRow = await db.employeeProduct.findUnique({
    where: {
      employeeId_productId: { employeeId: cleaner.id, productId },
    },
    select: {
      quantity: true,
      product: {
        select: { id: true, name: true, unit: true, deletedAt: true },
      },
    },
  });

  let product: KitProduct;
  if (kitRow) {
    // Archived or not, an existing row is editable in BOTH directions. Raising
    // it is a correction ("I miscounted, they have 5"), not a hand-out — this
    // action never takes anything off a warehouse shelf, so it cannot be used
    // to smuggle stock out of a discontinued product. Issuing more of one is
    // `bulkAssignCleanerInventory`'s FROM_LOCKER mode, which does check.
    product = kitRow.product;
  } else if (newQuantity === 0) {
    // Nothing to remove. Someone else cleared the row while this editor was
    // open — say that, rather than blaming a product that is fine.
    return { success: false, error: KIT_ROW_MISSING };
  } else {
    // No row yet: this creates an assignment, so the catalogue rules apply and
    // an archived product is refused (with its name, and the way back).
    const lookup = await findAssignableProduct(productId);
    if (!lookup.ok) return { success: false, error: lookup.error };
    product = lookup.product;
  }

  try {
    const returned = await db.$transaction(async (tx) => {
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
      if (previous === newQuantity) return null;

      // ── The explicit warehouse return (PDF #6) ────────────────────────────
      // Only when asked, and only for units this edit actually took OUT of the
      // kit. Ticking the box while increasing a count must never quietly
      // withdraw stock — that is an assignment, and it belongs to the flow that
      // records which location the stock left.
      const removed = Math.round((previous - newQuantity) * 100) / 100;
      let returnedInfo: SetCleanerProductQuantityResult["returned"] = undefined;

      if (wantsReturn && removed > 0) {
        // Which shelf they go back on, named in the audit reason — same rule
        // the hand-out paths follow, so a return is as traceable as an issue.
        const locationId = await ensureDefaultLocationId(tx);
        const location = await tx.inventoryLocation.findUnique({
          where: { id: locationId },
          select: { name: true },
        });
        const locationName = location?.name ?? "the warehouse";

        const moved = await adjustWarehouseStock(tx, {
          productId: product.id,
          locationId,
          delta: removed,
          action: "ADMIN_SET",
          unit: product.unit,
          reason: `Returned from ${cleaner.name ?? "cleaner"}'s kit — ${locationName}`,
          actor,
        });

        returnedInfo = {
          quantity: removed,
          unit: product.unit,
          locationName,
          stockLevel: moved.stockLevel,
        };
      }

      // The kit-side row. When units were returned it says so, so the pair
      // reads as one event in the product's Stock History instead of as a
      // shrinking kit next to an unexplained warehouse gain.
      const baseReason = reason ?? "Count set by admin";
      await tx.inventoryChange.create({
        data: {
          productId: product.id,
          employeeId: cleaner.id,
          employeeName: cleaner.name,
          quantityChange: newQuantity - previous,
          newQuantity,
          unit: product.unit,
          action: "ADMIN_SET",
          reason: returnedInfo
            ? `${baseReason} — ${returnedInfo.quantity} ${product.unit} returned to ${returnedInfo.locationName}`
            : baseReason,
          changedById: actor?.id ?? null,
          changedByName: actor?.name ?? null,
        },
      });

      return returnedInfo ?? null;
    }, {
      // With "Return to warehouse" ticked this is nine sequential queries: the
      // kit read and write, then `adjustWarehouseStock`'s location upsert, SUM,
      // cache write and audit row, plus the kit-side audit row. Supabase
      // round-trips take that past Prisma's default 5s window and the last
      // write fails with P2028, rolling the whole save back — which is exactly
      // why the box being TICKED was the case that silently did nothing while
      // the un-ticked save (no warehouse queries) worked.
      maxWait: 10_000,
      timeout: 30_000,
    });

    revalidatePath("/admin/inventory");
    revalidatePath(`/admin/inventory/${product.id}`);
    revalidatePath(`/admin/employees/${cleaner.id}`);
    revalidatePath("/cleaners/my-inventory");
    // Settings → Manage Stock reads the location rows a return moves.
    revalidatePath("/admin/settings");

    return returned ? { success: true, returned } : { success: true };
  } catch (e) {
    // Detail to the server log only; the client gets a generic message.
    console.error("setCleanerProductQuantity", e);
    return { success: false, error: "Could not update this cleaner's inventory." };
  }
}
