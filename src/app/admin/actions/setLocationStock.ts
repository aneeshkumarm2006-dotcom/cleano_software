"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface SetLocationStockInput {
  locationId: string;
  productId: string;
  quantity: number;
}

export async function setLocationStock(input: SetLocationStockInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    if (input.quantity < 0) {
      return { success: false, error: "Quantity cannot be negative" };
    }

    await db.inventoryLocationStock.upsert({
      where: {
        locationId_productId: {
          locationId: input.locationId,
          productId: input.productId,
        },
      },
      update: { quantity: input.quantity },
      create: {
        locationId: input.locationId,
        productId: input.productId,
        quantity: input.quantity,
      },
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/inventory");
    revalidatePath("/cleaners/my-inventory");
    return { success: true };
  } catch (error) {
    console.error("Error setting location stock:", error);
    return { success: false, error: "Failed to update stock" };
  }
}
