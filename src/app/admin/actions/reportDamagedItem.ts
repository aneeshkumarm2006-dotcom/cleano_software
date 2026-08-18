"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  ISSUE_LABEL,
  issueAuditReason,
  needsRestock,
  normalizeIssueType,
  writesOffCompanyStock,
  type InventoryIssueType,
} from "@/lib/inventory-issues";
import {
  conditionFlagType,
  type EquipmentCondition,
} from "@/lib/inventory-status";
import { adjustWarehouseStock, pickSourceLocationId } from "@/lib/stock.server";

/**
 * The condition a reported issue puts a REUSABLE tool into (Stage 2, PDF #4).
 *
 * Only the two issues that describe a physical fact about the tool map to a
 * condition. "Ran out" is a consumable idea — a broom cannot be used up — and
 * "Other" is by definition unstated, so neither is allowed to overwrite a
 * condition an admin may be acting on. `null` means "leave the condition
 * alone", which is different from reporting it as fine.
 */
const ISSUE_CONDITION: Record<InventoryIssueType, EquipmentCondition | null> = {
  LOST: "MISSING",
  BROKEN: "DAMAGED",
  RAN_OUT: null,
  OTHER: null,
};

/**
 * Cleaner reports an inventory issue against their own kit
 * (awer_fixes.pdf item 15): product, issue type, quantity and an optional note.
 *
 * Issue types are Lost, Broken, Ran out and Other. They are NOT equivalent:
 * only genuine loss (Lost/Broken) is written off against company stock. "Ran
 * out" is normal consumption — company stock was already reduced when the
 * product was handed over, so writing it off again would double-count — and
 * "Other" is unexplained, so it adjusts the kit and asks an admin to look
 * rather than quietly reducing what the company believes it owns.
 * See src/lib/inventory-issues.ts.
 *
 * Every movement is written to `InventoryChange`, so reported issues appear in
 * the admin inventory activity log (item 18) and in the product's Stock History.
 *
 * AUTHZ: the kit row is looked up by the SESSION user id — a cleaner can only
 * ever report against their own kit.
 */
export async function reportDamagedItem(input: {
  productId: string;
  quantity?: number;
  reason?: string;
  /** "LOST" | "BROKEN" | "RAN_OUT" | "OTHER". Legacy "damaged"/"lost" accepted. */
  kind?: InventoryIssueType | "damaged" | "lost";
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const rawQty = Number(input.quantity ?? 1);
  if (!Number.isFinite(rawQty) || rawQty <= 0) {
    return { success: false, error: "Quantity must be greater than zero" };
  }
  const qty = Math.max(1, Math.floor(rawQty));
  const issue = normalizeIssueType(input.kind);
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
      product: {
        select: { name: true, unit: true, stockLevel: true, itemType: true },
      },
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
  const writeOff = writesOffCompanyStock(issue);
  const auditReason = issueAuditReason(issue, reason);
  const label = ISSUE_LABEL[issue];

  // Stage 2 (PDF #4): a reported issue against a REUSABLE tool is also a
  // condition report. A cleaner saying "my scraper broke" should leave the
  // admin looking at a DAMAGED scraper in a review queue, not just a kit count
  // that quietly went down by one. The stock rules above are untouched —
  // LOST/BROKEN still write off company stock, RAN_OUT/OTHER still don't.
  const isEquipment = kit.product.itemType === "REUSABLE_EQUIPMENT";
  const newCondition = isEquipment ? ISSUE_CONDITION[issue] : null;
  const flagType = newCondition ? conditionFlagType(newCondition) : null;
  const now = new Date();

  // ONE transaction so a partial report can never leave the kit, the warehouse
  // and the audit trail disagreeing.
  //
  // Stage 4 turned this from the array form into the interactive form. It had
  // to: `adjustWarehouseStock` reads the location rows, recomputes the total
  // and writes — that cannot be expressed as a prepared promise. The upside is
  // that the open-flag lookup moved INSIDE the transaction too, closing the
  // duplicate-flag race Stage 2 recorded as a known limit.
  await db.$transaction(async (tx) => {
    // The cleaner's kit always reflects reality.
    await tx.employeeProduct.update({
      where: { id: kit.id },
      data: {
        quantity: { decrement: qty },
        ...(newCondition
          ? {
              condition: newCondition,
              statusUpdatedAt: now,
              statusNotes: reason || null,
            }
          : {}),
      },
    });

    // Audit: the cleaner's assigned stock.
    await tx.inventoryChange.create({
      data: {
        productId: input.productId,
        employeeId: actor.id,
        employeeName: actor.name ?? null,
        quantityChange: -qty,
        newQuantity: newKitQty,
        unit: kit.product.unit,
        action: "ISSUE",
        // The status transition, when this report carries one (PDF #1's
        // history list). Null on consumables, which have no condition.
        previousStatus: newCondition ? (kit.condition ?? null) : null,
        newStatus: newCondition,
        reason: auditReason,
        changedById: actor.id,
        changedByName: actor.name ?? null,
      },
    });

    if (writeOff) {
      // The matching write-off against company stock. Which items are written
      // off is unchanged (LOST/BROKEN yes, RAN_OUT/OTHER no) — only the route
      // changed: it now goes through the one helper that moves the location row
      // and `stockLevel` together, instead of decrementing the count alone and
      // leaving the locker saying something else.
      const locationId = await pickSourceLocationId(tx, input.productId, qty);
      await adjustWarehouseStock(tx, {
        productId: input.productId,
        locationId,
        delta: -qty,
        action: "ISSUE",
        unit: kit.product.unit,
        reason: auditReason,
        actor,
      });
    }

    if (flagType) {
      // De-dupe against whatever is already OPEN for this (cleaner, product,
      // type), so a cleaner reporting the same broken scraper twice leaves the
      // admin one thing to action rather than two.
      const openFlag = await tx.inventoryFlag.findFirst({
        where: {
          employeeId: actor.id,
          productId: input.productId,
          type: flagType,
          status: "OPEN",
        },
        select: { id: true },
      });
      if (openFlag) {
        await tx.inventoryFlag.update({
          where: { id: openFlag.id },
          data: { notes: reason || null },
        });
      } else {
        await tx.inventoryFlag.create({
          data: {
            type: flagType,
            employeeId: actor.id,
            productId: input.productId,
            source: "ISSUE_REPORT",
            notes: reason || null,
          },
        });
      }
    }

    await tx.alert.create({
      data: {
        type: "LOW_INVENTORY",
        severity: needsRestock(issue) ? "INFO" : "WARNING",
        title: `${label}: ${kit.product.name}`,
        message:
          `${actor.name ?? "A cleaner"} reported ${qty} ${kit.product.name} as ${label.toLowerCase()}.` +
          (reason ? ` Note: ${reason}` : "") +
          (writeOff
            ? " Master stock and the cleaner's kit have both been decremented."
            : needsRestock(issue)
            ? " Their kit has been reduced — they may need a restock."
            : " Their kit has been reduced; company stock is unchanged pending review."),
        relatedId: input.productId,
        relatedType: "Product",
      },
    });
  }, {
    // A write-off is nine sequential queries: the kit update, its audit row,
    // `adjustWarehouseStock`'s source-location pick, upsert, SUM, cache write
    // and audit row, the flag de-dupe, and the alert. Supabase round-trips take
    // that past Prisma's default 5s window, and a P2028 partway through would
    // roll a cleaner's report back without telling them.
    maxWait: 10_000,
    timeout: 30_000,
  });

  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/settings");
  return { success: true };
}
