"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  resolveDocumentAssignees,
  type DocumentAssignInput,
} from "@/lib/document-assignees";

interface AssignDocumentInput extends DocumentAssignInput {
  documentId: string;
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

    const targetIds = await resolveDocumentAssignees({
      mode: input.mode,
      roles: input.roles,
      userIds: input.userIds,
    });

    if (targetIds.length === 0) {
      return { success: false, error: "No matching staff found" };
    }

    // `count` is rows actually inserted — people already assigned are skipped,
    // so this is the number the admin is told about rather than the size of the
    // target set.
    const created = await db.documentSignature.createMany({
      data: targetIds.map((employeeId) => ({
        documentId: input.documentId,
        employeeId,
        status: "PENDING" as const,
      })),
      skipDuplicates: true,
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/documents");
    return { success: true, assignedCount: created.count };
  } catch (error) {
    console.error("Error assigning document:", error);
    return { success: false, error: "Failed to assign document" };
  }
}
