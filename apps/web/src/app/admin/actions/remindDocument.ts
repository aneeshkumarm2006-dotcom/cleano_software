"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function remindDocument(documentId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }
    if (!documentId) {
      return { success: false, error: "Document id is required" };
    }

    const doc = await db.document.findUnique({
      where: { id: documentId },
      include: {
        signatures: {
          where: { status: "PENDING" },
          select: { employeeId: true },
        },
      },
    });
    if (!doc) return { success: false, error: "Document not found" };
    if (doc.signatures.length === 0) {
      return { success: false, error: "No pending signers to remind" };
    }

    await db.alert.create({
      data: {
        type: "GENERAL",
        severity: "WARNING",
        title: "Document signature reminder",
        message: `${doc.signatures.length} employee(s) still need to sign "${doc.title}".`,
        relatedId: documentId,
        relatedType: "DOCUMENT",
      },
    });

    revalidatePath("/admin/settings");
    return { success: true, reminded: doc.signatures.length };
  } catch (error) {
    console.error("Error sending reminders:", error);
    return { success: false, error: "Failed to send reminders" };
  }
}
