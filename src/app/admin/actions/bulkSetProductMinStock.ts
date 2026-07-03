"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

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

// Bulk-set the min-stock threshold of the selected (non-deleted) products.
export async function bulkSetProductMinStock(
  ids: string[],
  minStock: number
): Promise<
  { success: true; count: number } | { success: false; error: string }
> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  if (
    typeof minStock !== "number" ||
    !Number.isFinite(minStock) ||
    minStock < 0
  ) {
    return { success: false, error: "Invalid min-stock value" };
  }

  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0)
    return { success: false, error: "Nothing selected" };

  try {
    const res = await db.product.updateMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      data: { minStock },
    });
    revalidatePath("/admin/inventory");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetProductMinStock", e);
    return { success: false, error: "Failed to update min-stock" };
  }
}
