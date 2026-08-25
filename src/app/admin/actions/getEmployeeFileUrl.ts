"use server";

import { db } from "@/lib/org-db";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { logActivity } from "@/lib/activity-log";
import { signedFileUrl } from "@/lib/cloudinary";

/**
 * Mint a short-lived signed URL for an employee-uploaded file
 * (awerfixes.pdf item 16, decision 7). This is the ONLY way to read one.
 *
 * `requireOwnerAdmin` from action-guards, NOT the four-role admin set:
 * OPS_MANAGER and FIELD_LEAD run the schedule, not payroll, and have no reason
 * to see anyone's banking details. The employee detail page already redirects
 * those two, but a page redirect leaves the action callable — this guard is
 * what actually enforces it.
 *
 * Every successful mint is recorded. Banking documents are exactly the class of
 * data where "who looked, and when" has to be answerable later.
 */
export async function getEmployeeFileUrl(fileId: string): Promise<
  { success: true; url: string } | { success: false; error: string }
> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };
  if (!fileId) return { success: false, error: "No file specified" };

  try {
    const file = await db.employeeFile.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        employeeId: true,
        kind: true,
        publicId: true,
        resourceType: true,
      },
    });
    if (!file) return { success: false, error: "File not found" };

    const url = signedFileUrl({
      publicId: file.publicId,
      resourceType: file.resourceType,
      // Long enough to open in a new tab, short enough that a link pasted into
      // a chat is dead by the time anyone else clicks it.
      ttlSeconds: 300,
    });
    if (!url) {
      return { success: false, error: "Uploads are not configured on the server" };
    }

    await logActivity({
      category: "ADMIN",
      action: "employee_file.view",
      status: "SUCCESS",
      actorId: guard.userId,
      actorLabel: guard.role,
      targetType: "User",
      targetId: file.employeeId,
      message: `Viewed employee file (${file.kind})`,
      // Records THAT a banking document was opened, never the document. The
      // signed URL and the publicId stay out of the log — an audit trail must
      // not become a second copy of the thing it is auditing (same rule as
      // clientAddresses.ts).
      metadata: { employeeFileId: file.id, kind: file.kind },
    });

    return { success: true, url };
  } catch (error) {
    console.error("Error minting employee file URL:", error);
    return { success: false, error: "Failed to open file" };
  }
}
