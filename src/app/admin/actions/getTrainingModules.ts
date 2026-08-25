"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getTrainingModules(employeeId?: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false as const, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";

    const targetEmployeeId = employeeId && isAdmin ? employeeId : session.user.id;

    const modules = await db.trainingModule.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        quizzes: { orderBy: { sortOrder: "asc" } },
        progress: {
          where: { employeeId: targetEmployeeId },
          take: 1,
        },
      },
    });

    return { success: true as const, modules };
  } catch (error) {
    console.error("Error fetching training modules:", error);
    return { success: false as const, error: "Failed to fetch modules" };
  }
}
