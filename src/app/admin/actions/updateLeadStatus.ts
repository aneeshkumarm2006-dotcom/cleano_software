"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

type LeadStatus = "NEW" | "CONTACTED" | "CONVERTED" | "DEAD" | "OUT_OF_AREA";

export async function updateLeadStatus(input: { id: string; status: LeadStatus }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    await db.lead.update({
      where: { id: input.id },
      data: {
        status: input.status,
        lastActivityAt: new Date(),
      },
    });

    revalidatePath("/admin/leads");
    return { success: true };
  } catch (error) {
    console.error("Error updating lead status:", error);
    return { success: false, error: "Failed to update lead" };
  }
}
