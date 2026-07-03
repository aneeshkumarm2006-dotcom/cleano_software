"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

async function requireStaff(): Promise<
  { ok: true; userId: string; userName: string } | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true, userId: session.user.id, userName: session.user.name ?? "Admin" };
}

function sanitizeIds(ids: string[]): string[] {
  return Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
}

// Bulk-assign a single cleaner to many jobs: connects the cleaner to each job's
// `cleaners` relation (idempotent) and sets `employeeId` where it's still unset.
export async function bulkAssignCleaner(
  jobIds: string[],
  cleanerId: string
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  const cleanIds = sanitizeIds(jobIds);
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };
  if (!cleanerId) return { success: false, error: "No cleaner chosen" };

  try {
    const cleaner = await db.user.findFirst({
      where: {
        id: cleanerId,
        role: { in: ["EMPLOYEE", "FIELD_LEAD"] },
      },
      select: { id: true },
    });
    if (!cleaner) return { success: false, error: "Cleaner not found" };

    const jobs = await db.job.findMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      select: { id: true, employeeId: true },
    });
    if (jobs.length === 0) return { success: false, error: "Nothing selected" };

    await db.$transaction([
      ...jobs.map((j) =>
        db.job.update({
          where: { id: j.id },
          data: {
            cleaners: { connect: { id: cleanerId } },
            ...(j.employeeId ? {} : { employeeId: cleanerId }),
          },
        })
      ),
      ...jobs.map((j) =>
        db.jobLog.create({
          data: {
            jobId: j.id,
            userId: gate.userId,
            action: "UPDATED",
            field: "cleaners",
            description: `Cleaner assigned via bulk action by ${gate.userName}`,
          },
        })
      ),
    ]);

    revalidatePath("/admin/jobs");
    return { success: true, count: jobs.length };
  } catch (e) {
    console.error("bulkAssignCleaner", e);
    return { success: false, error: "Failed to assign cleaner" };
  }
}
