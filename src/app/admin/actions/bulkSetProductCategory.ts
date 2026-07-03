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

// Categories mirror the ProductCategory enum in the Prisma schema.
const ALLOWED_CATEGORIES = [
  "LIQUID_SPRAY",
  "MOP_LIQUID",
  "DISPOSABLE",
  "OTHER",
] as const;
type BulkCategory = (typeof ALLOWED_CATEGORIES)[number];

// Bulk-set the category of the selected (non-deleted) products to a validated value.
export async function bulkSetProductCategory(
  ids: string[],
  category: string
): Promise<
  { success: true; count: number } | { success: false; error: string }
> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  if (!ALLOWED_CATEGORIES.includes(category as BulkCategory)) {
    return { success: false, error: "Invalid category" };
  }

  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0)
    return { success: false, error: "Nothing selected" };

  try {
    const res = await db.product.updateMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      data: { category: category as BulkCategory },
    });
    revalidatePath("/admin/inventory");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetProductCategory", e);
    return { success: false, error: "Failed to update category" };
  }
}
