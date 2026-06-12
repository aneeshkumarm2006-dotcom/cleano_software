"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function deleteTarget(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized" };
  }

  const userWithRole = session.user as typeof session.user & {
    role?: string;
  };

  if (userWithRole.role !== "OWNER" && userWithRole.role !== "ADMIN") {
    return { error: "Only admins can manage targets" };
  }

  try {
    const targetId = formData.get("targetId") as string;

    if (!targetId) {
      return { error: "Missing target id" };
    }

    await db.target.delete({
      where: { id: targetId },
    });

    revalidatePath("/analytics");
    return { success: true };
  } catch (error) {
    console.error("Error deleting target:", error);
    return { error: "Failed to delete target" };
  }
}
