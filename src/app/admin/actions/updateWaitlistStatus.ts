"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

type Status = "WAITING" | "NOTIFIED" | "CONVERTED" | "EXPIRED" | "CANCELLED";

export async function updateWaitlistStatus(input: {
  id: string;
  status: Status;
}) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    await db.waitlist.update({
      where: { id: input.id },
      data: { status: input.status },
    });

    revalidatePath("/admin/waitlist");
    return { success: true };
  } catch (error) {
    console.error("Error updating waitlist:", error);
    return { success: false, error: "Failed to update" };
  }
}
