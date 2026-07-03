"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { JobApplicationStatus } from "@prisma/client";

type Result = { success: true; count: number } | { success: false; error: string };

const VALID = new Set<string>(Object.values(JobApplicationStatus));

// Bulk-set JobApplication.status for the selected ids. Gated on staff roles like the
// single-item updateApplicationStatus action. Validates the enum, idempotent (updateMany).
export async function bulkSetApplicationStatus(
  ids: string[],
  status: JobApplicationStatus
): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  if (!VALID.has(status)) return { success: false, error: "Invalid status" };

  const cleanIds = Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  try {
    const res = await db.jobApplication.updateMany({
      where: { id: { in: cleanIds } },
      data: { status },
    });
    revalidatePath("/admin/job-applications");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetApplicationStatus", e);
    return { success: false, error: "Failed to update selected applications" };
  }
}
