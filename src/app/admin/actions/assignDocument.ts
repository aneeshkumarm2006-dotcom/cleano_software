"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface AssignDocumentInput {
  documentId: string;
  mode: "ALL" | "ROLES" | "USERS";
  roles?: ("OWNER" | "ADMIN" | "EMPLOYEE")[];
  userIds?: string[];
}

export async function assignDocument(input: AssignDocumentInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    if (!input.documentId) {
      return { success: false, error: "Document id is required" };
    }

    const doc = await db.document.findUnique({
      where: { id: input.documentId },
      select: { id: true },
    });
    if (!doc) return { success: false, error: "Document not found" };

    let targetIds: string[] = [];
    if (input.mode === "ALL") {
      const users = await db.user.findMany({ select: { id: true } });
      targetIds = users.map((u) => u.id);
    } else if (input.mode === "ROLES" && input.roles?.length) {
      const users = await db.user.findMany({
        where: { role: { in: input.roles } },
        select: { id: true },
      });
      targetIds = users.map((u) => u.id);
    } else if (input.mode === "USERS" && input.userIds?.length) {
      targetIds = input.userIds;
    } else {
      return { success: false, error: "No assignees specified" };
    }

    if (targetIds.length === 0) {
      return { success: false, error: "No matching users found" };
    }

    await db.documentSignature.createMany({
      data: targetIds.map((employeeId) => ({
        documentId: input.documentId,
        employeeId,
        status: "PENDING" as const,
      })),
      skipDuplicates: true,
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/documents");
    return { success: true, assignedCount: targetIds.length };
  } catch (error) {
    console.error("Error assigning document:", error);
    return { success: false, error: "Failed to assign document" };
  }
}
