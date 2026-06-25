"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface UpdateInventoryLocationInput {
  id: string;
  name: string;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export async function updateInventoryLocation(
  input: UpdateInventoryLocationInput
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    if (!input.name?.trim()) {
      return { success: false, error: "Location name is required" };
    }

    await db.inventoryLocation.update({
      where: { id: input.id },
      data: {
        name: input.name.trim(),
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
        isActive: input.isActive ?? true,
      },
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/inventory");
    revalidatePath("/cleaners/my-inventory");
    return { success: true };
  } catch (error) {
    console.error("Error updating inventory location:", error);
    return { success: false, error: "Failed to update location" };
  }
}
