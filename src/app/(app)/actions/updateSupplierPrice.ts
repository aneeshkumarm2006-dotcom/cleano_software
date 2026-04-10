"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface UpdateSupplierPriceParams {
  supplierId: string;
  productId: string;
  price: number;
  unit?: string | null;
  notes?: string | null;
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }
  return { session };
}

export async function updateSupplierPrice(params: UpdateSupplierPriceParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const { supplierId, productId, price, unit, notes } = params;
    if (!supplierId || !productId) {
      return { success: false, error: "Supplier and product are required" };
    }
    if (price < 0) {
      return { success: false, error: "Price cannot be negative" };
    }

    await db.supplierPrice.upsert({
      where: { supplierId_productId: { supplierId, productId } },
      create: {
        supplierId,
        productId,
        price,
        unit: unit?.trim() || null,
        notes: notes?.trim() || null,
      },
      update: {
        price,
        unit: unit?.trim() || null,
        notes: notes?.trim() || null,
      },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Error updating supplier price:", error);
    return { success: false, error: "Failed to update supplier price" };
  }
}

export async function deleteSupplierPrice(
  supplierId: string,
  productId: string
) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    await db.supplierPrice.delete({
      where: { supplierId_productId: { supplierId, productId } },
    });
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Error deleting supplier price:", error);
    return { success: false, error: "Failed to delete supplier price" };
  }
}
