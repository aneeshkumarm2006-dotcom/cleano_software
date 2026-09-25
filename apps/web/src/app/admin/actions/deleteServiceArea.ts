"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function deleteServiceArea(id: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }
    if (!id) return { success: false, error: "Missing id" };

    await db.serviceArea.delete({ where: { id } });

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error) {
    console.error("Error deleting service area:", error);
    return { success: false, error: "Failed to delete service area" };
  }
}
