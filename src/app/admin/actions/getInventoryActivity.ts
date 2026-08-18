"use server";

import { db } from "@/db";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { activityActionLabel, isInventoryAction } from "@/lib/inventory-action";
import type {
  InventoryActivityEntry,
  InventoryActivityPage,
} from "./getInventoryActivity.types";

/**
 * Paginated inventory activity log (awer_fixes.pdf item 18).
 *
 * Reads the InventoryChange audit trail that every stock-moving path writes:
 * quick assign, kit assignment, warehouse pickups, manual adjustments, reported
 * damage/loss, cleaner self-counts, request fulfilment and the closing
 * inventory report at clock-out.
 *
 * The verb on each row is now STORED (`InventoryChange.action`) rather than
 * pattern-matched out of its `reason` sentence — see
 * `src/lib/inventory-action.ts` for why, and for how rows written before that
 * column existed are still labelled.
 *
 * CURSOR pagination, not offset: the log grows constantly, and `skip` would
 * duplicate or drop rows as new activity lands mid-scroll. The cursor is the
 * last row's id, which is stable.
 *
 * OWNER/ADMIN only — it exposes who holds what across the whole company.
 */

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function getInventoryActivity(input?: {
  cursor?: string | null;
  pageSize?: number;
  /** Optional filters. */
  cleanerId?: string | null;
  productId?: string | null;
}): Promise<
  { success: true; page: InventoryActivityPage } | { success: false; error: string }
> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const requested = Number(input?.pageSize);
  const take = Number.isFinite(requested)
    ? Math.min(Math.max(1, Math.trunc(requested)), MAX_PAGE_SIZE)
    : PAGE_SIZE;

  const cursor =
    typeof input?.cursor === "string" && input.cursor.trim().length > 0
      ? input.cursor.trim()
      : null;

  const cleanerId =
    typeof input?.cleanerId === "string" && input.cleanerId.trim().length > 0
      ? input.cleanerId.trim()
      : null;
  const productId =
    typeof input?.productId === "string" && input.productId.trim().length > 0
      ? input.productId.trim()
      : null;

  try {
    const rows = await db.inventoryChange.findMany({
      where: {
        ...(cleanerId ? { employeeId: cleanerId } : {}),
        ...(productId ? { productId } : {}),
      },
      // Newest first, id as the tie-breaker so the cursor is deterministic when
      // several rows share a timestamp (a bulk save writes many at once).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // Over-fetch by one to learn whether another page exists without a count.
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        employeeId: true,
        employeeName: true,
        productId: true,
        quantityChange: true,
        newQuantity: true,
        unit: true,
        reason: true,
        // Stage 3: the stored verb and the status transition. `action` retires
        // the reason-string pattern matching this file used to do; it is null
        // on every row written before that migration, which is exactly why the
        // derived reading still exists.
        action: true,
        previousStatus: true,
        newStatus: true,
        changedByName: true,
        product: { select: { name: true } },
      },
    });

    const hasMore = rows.length > take;
    const pageRows = hasMore ? rows.slice(0, take) : rows;

    const entries: InventoryActivityEntry[] = pageRows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      cleanerId: r.employeeId,
      cleanerName: r.employeeName,
      productId: r.productId,
      productName: r.product?.name ?? "Deleted product",
      action: activityActionLabel(r.action, r.reason, r.employeeId === null),
      actionDerived: !isInventoryAction(r.action),
      previousStatus: r.previousStatus,
      newStatus: r.newStatus,
      quantityChange: r.quantityChange,
      newQuantity: r.newQuantity,
      unit: r.unit,
      note: r.reason,
      byName: r.changedByName,
    }));

    return {
      success: true,
      page: {
        entries,
        nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
      },
    };
  } catch (error) {
    console.error("getInventoryActivity failed", error);
    return { success: false, error: "Could not load inventory activity." };
  }
}
