"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function updateTarget(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized" };
  }

  const userWithRole = session.user as typeof session.user & {
    role: "OWNER" | "ADMIN" | "EMPLOYEE";
  };

  if (userWithRole.role === "EMPLOYEE") {
    return { error: "Only admins can manage targets" };
  }

  try {
    const targetId = formData.get("targetId") as string;
    const targetValue = parseFloat(formData.get("targetValue") as string);
    const notes = (formData.get("notes") as string) || null;

    if (!targetId || !Number.isFinite(targetValue)) {
      return { error: "Missing required fields" };
    }

    const target = await db.target.update({
      where: { id: targetId },
      data: {
        targetValue,
        notes,
      },
    });

    revalidatePath("/analytics");
    return { success: true, target };
  } catch (error) {
    console.error("Error updating target:", error);
    return { error: "Failed to update target" };
  }
}
