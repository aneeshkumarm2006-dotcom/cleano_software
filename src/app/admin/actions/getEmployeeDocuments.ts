"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getEmployeeDocuments(employeeId?: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { success: false as const, error: "Not authenticated" };
    }
    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";

    const targetEmployeeId =
      employeeId && isAdmin ? employeeId : session.user.id;

    const signatures = await db.documentSignature.findMany({
      where: { employeeId: targetEmployeeId },
      orderBy: [
        { status: "asc" },
        { createdAt: "desc" },
      ],
      include: {
        document: {
          select: {
            id: true,
            title: true,
            description: true,
            version: true,
            dueDate: true,
            createdAt: true,
            fileUrl: true,
          },
        },
      },
    });

    return { success: true as const, signatures };
  } catch (error) {
    console.error("Error fetching employee documents:", error);
    return { success: false as const, error: "Failed to fetch documents" };
  }
}
