"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { sendProviderDocumentUploaded } from "@/lib/email";
import {
  resolveDocumentAssignees,
  type DocumentAssignInput,
} from "@/lib/document-assignees";

interface CreateDocumentInput {
  title: string;
  description?: string | null;
  content?: string | null;
  fileUrl?: string | null;
  version?: string;
  dueDate?: string | null;
  assignTo?: DocumentAssignInput;
}

export async function createDocument(input: CreateDocumentInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    if (!input.title?.trim()) {
      return { success: false, error: "Title is required" };
    }
    if (!input.content?.trim() && !input.fileUrl?.trim()) {
      return {
        success: false,
        error: "Either content text or a file URL is required",
      };
    }

    const due = input.dueDate ? new Date(input.dueDate) : null;
    if (due && Number.isNaN(due.getTime())) {
      return { success: false, error: "Invalid due date" };
    }

    const document = await db.document.create({
      data: {
        title: input.title.trim(),
        description: input.description?.trim() || null,
        content: input.content?.trim() || null,
        fileUrl: input.fileUrl?.trim() || null,
        version: input.version?.trim() || "1.0",
        dueDate: due,
      },
    });

    if (input.assignTo) {
      const targetUserIds = await resolveDocumentAssignees(input.assignTo);
      if (targetUserIds.length > 0) {
        await db.documentSignature.createMany({
          data: targetUserIds.map((employeeId) => ({
            documentId: document.id,
            employeeId,
            status: "PENDING" as const,
          })),
          skipDuplicates: true,
        });
        // Notify each assigned provider that a new document is on their drive
        // (gated by `prov.drive.doc_uploaded`). Assignees are staff-only by
        // construction — resolveDocumentAssignees filters CLIENT out.
        const assignedUsers = await db.user.findMany({
          where: { id: { in: targetUserIds } },
          select: { name: true, email: true },
        });
        for (const u of assignedUsers) {
          if (!u.email) continue;
          sendProviderDocumentUploaded({
            to: u.email,
            providerName: u.name,
            documentTitle: document.title,
          }).catch((e) => console.error("provider doc-uploaded", e));
        }
      }
    }

    revalidatePath("/admin/settings");
    revalidatePath("/admin/documents");
    return { success: true, documentId: document.id };
  } catch (error) {
    console.error("Error creating document:", error);
    return { success: false, error: "Failed to create document" };
  }
}
