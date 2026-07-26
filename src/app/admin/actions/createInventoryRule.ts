"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface CreateInventoryRuleParams {
  productId: string;
  usagePerJob: number;
  refillThreshold: number;
}

export async function createInventoryRule(params: CreateInventoryRuleParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const { productId, usagePerJob, refillThreshold } = params;
    if (!productId) return { success: false, error: "Product is required" };
    if (usagePerJob < 0 || refillThreshold < 0) {
      return { success: false, error: "Values cannot be negative" };
    }

    // Product.cleanerRestockThreshold is the authoritative cleaner restock
    // threshold (fix list item 14); InventoryRule.refillThreshold is kept in
    // step so this legacy editor can't silently disagree with the product page.
    // Both are written together so neither can drift.
    await db.$transaction([
      db.inventoryRule.upsert({
        where: { productId },
        create: { productId, usagePerJob, refillThreshold },
        update: { usagePerJob, refillThreshold },
      }),
      db.product.update({
        where: { id: productId },
        data: { cleanerRestockThreshold: refillThreshold },
      }),
    ]);

    revalidatePath("/admin/settings");
    revalidatePath("/admin/inventory");
    return { success: true };
  } catch (error) {
    console.error("Error creating inventory rule:", error);
    return { success: false, error: "Failed to create inventory rule" };
  }
}
