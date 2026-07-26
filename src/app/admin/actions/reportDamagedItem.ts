"use server";

import { db } from "@/db";
import type { Prisma } from "@prisma/client";
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
  const writeOff = writesOffCompanyStock(issue);
  const newStockLevel = kit.product.stockLevel - qty;
  const auditReason = issueAuditReason(issue, reason);
  const label = ISSUE_LABEL[issue];

  // Built up conditionally, then run as ONE transaction so a partial report can
  // never leave the kit and the audit trail disagreeing.
  const ops: Prisma.PrismaPromise<unknown>[] = [
    // The cleaner's kit always reflects reality.
    db.employeeProduct.update({
      where: { id: kit.id },
      data: { quantity: { decrement: qty } },
    }),
    // Audit: the cleaner's assigned stock.
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
  ];

  if (writeOff) {
    ops.push(
      db.product.update({
        where: { id: input.productId },
        data: { stockLevel: { decrement: qty } },
      }),
      // The matching write-off against master/warehouse stock.
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
      })
    );
  }

  ops.push(
    db.alert.create({
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
    })
  );

  await db.$transaction(ops);

  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/admin/inventory");
  return { success: true };
}
