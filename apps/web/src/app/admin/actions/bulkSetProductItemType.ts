"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isItemType } from "@/lib/item-type";

async function requireStaff(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true };
}

function sanitizeIds(ids: string[]): string[] {
  return Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
}

/**
 * Bulk-set the item type of the selected (non-deleted) products.
 *
 * This is the escape hatch for `prisma/backfillItemTypes.ts`: a name regex will
 * always misfile a few products, and the admin needs to fix a whole column of
 * them in one pass rather than opening 17 modals.
 *
 * Classification is metadata, not a stock movement — deliberately no
 * `InventoryChange` rows, exactly like `bulkSetProductCategory`.
 */
export async function bulkSetProductItemType(
  ids: string[],
  itemType: string
): Promise<
  { success: true; count: number } | { success: false; error: string }
> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  if (!isItemType(itemType)) {
    return { success: false, error: "Invalid item type" };
  }

  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0)
    return { success: false, error: "Nothing selected" };

  try {
    const res = await db.product.updateMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      data: { itemType },
    });
    revalidatePath("/admin/inventory");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetProductItemType", e);
    return { success: false, error: "Failed to update item type" };
  }
}
