"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface UpdateServiceAreaInput {
  id: string;
  zoneName?: string;
  travelFee?: number;
  notes?: string | null;
  isActive?: boolean;
}

export async function updateServiceArea(input: UpdateServiceAreaInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }
    if (!input.id) return { success: false, error: "Missing id" };

    const data: Record<string, unknown> = {};
    if (input.zoneName !== undefined) {
      if (!input.zoneName.trim()) {
        return { success: false, error: "Zone name cannot be empty" };
      }
      data.zoneName = input.zoneName.trim();
    }
    if (input.travelFee !== undefined) data.travelFee = input.travelFee;
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    await db.serviceArea.update({ where: { id: input.id }, data });

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error) {
    console.error("Error updating service area:", error);
    return { success: false, error: "Failed to update service area" };
  }
}
