"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

async function requireStaff(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true, userId: session.user.id };
}

function sanitizeIds(ids: string[]): string[] {
  return Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
}

// Bulk-cancel jobs: sets status = CANCELLED for the selected jobs that are not
// already cancelled or completed. Skips completed/cancelled rows silently.
export async function bulkCancelJobs(
  ids: string[]
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  try {
    const res = await db.job.updateMany({
      where: {
        id: { in: cleanIds },
        status: { notIn: ["CANCELLED", "COMPLETED"] },
        deletedAt: null,
      },
      data: { status: "CANCELLED" },
    });
    revalidatePath("/admin/jobs");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkCancelJobs", e);
    return { success: false, error: "Failed to cancel selected jobs" };
  }
}
