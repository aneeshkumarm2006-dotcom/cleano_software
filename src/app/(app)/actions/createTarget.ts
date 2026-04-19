"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import type { TargetMetric, TargetPeriod } from "@prisma/client";

export async function createTarget(formData: FormData) {
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
    const metric = formData.get("metric") as TargetMetric;
    const period = formData.get("period") as TargetPeriod;
    const periodStart = new Date(formData.get("periodStart") as string);
    const targetValue = parseFloat(formData.get("targetValue") as string);
    const notes = (formData.get("notes") as string) || null;

    if (!metric || !period || !periodStart || !Number.isFinite(targetValue)) {
      return { error: "Missing required fields" };
    }

    const target = await db.target.create({
      data: {
        metric,
        period,
        periodStart,
        targetValue,
        notes,
      },
    });

    revalidatePath("/analytics");
    return { success: true, target };
  } catch (error: any) {
    if (error?.code === "P2002") {
      return { error: "A target for this metric, period, and start date already exists" };
    }
    console.error("Error creating target:", error);
    return { error: "Failed to create target" };
  }
}
