"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface UpdateInventoryRuleParams {
  productId: string;
  usagePerJob: number;
  refillThreshold: number;
}

export async function updateInventoryRule(params: UpdateInventoryRuleParams) {
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

    await db.inventoryRule.upsert({
      where: { productId },
      create: { productId, usagePerJob, refillThreshold },
      update: { usagePerJob, refillThreshold },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Error updating inventory rule:", error);
    return { success: false, error: "Failed to update inventory rule" };
  }
}

export async function deleteInventoryRule(productId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    await db.inventoryRule.delete({ where: { productId } });
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Error deleting inventory rule:", error);
    return { success: false, error: "Failed to delete inventory rule" };
  }
}
