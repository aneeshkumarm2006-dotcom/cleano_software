"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { evaluateEmployeeWindows } from "@/lib/job-assignments";
import { availabilityWarning, windowFromInstants } from "@/lib/availability";
import { categoryMismatchWarning } from "@/lib/service-permissions";

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
//
// Availability conflicts (item 8) come back as `warnings` — one line per job the
// cleaner is being put on outside their recurring availability or on a blocked
// date. Advisory only: the assignment still goes through so an admin can
// override, exactly like the per-job Team card.
export async function bulkAssignCleaner(
  jobIds: string[],
  cleanerId: string
): Promise<
  | { success: true; count: number; warnings: string[] }
  | { success: false; error: string }
> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  const cleanIds = sanitizeIds(jobIds);
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };
  if (!cleanerId || typeof cleanerId !== "string") {
    return { success: false, error: "No cleaner chosen" };
  }

  try {
    const cleaner = await db.user.findFirst({
      where: {
        id: cleanerId,
        role: { in: ["EMPLOYEE", "FIELD_LEAD"] },
      },
      select: {
        id: true,
        name: true,
        cleanerTier: true,
        allowedServiceCategories: true,
      },
    });
    if (!cleaner) return { success: false, error: "Cleaner not found" };

    // Trainees must be paired with a Field Lead (item 2). Bulk-assign adds one
    // cleaner across many jobs and can't guarantee a Field Lead on each, so
    // trainees are steered to the per-job Team card where pairing is enforced.
    if (cleaner.cleanerTier === "TRAINEE") {
      return {
        success: false,
        error:
          "Trainees must be paired with a Field Lead — assign them from a job's Team card, not bulk assign.",
      };
    }

    const jobs = await db.job.findMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      select: {
        id: true,
        jobNumber: true,
        employeeId: true,
        startTime: true,
        endTime: true,
        // Service-category advisory (awerfixes.pdf item 3).
        jobType: true,
      },
    });
    if (jobs.length === 0) return { success: false, error: "Nothing selected" };

    // Availability check per job (recurring rule + one-off blocked dates), in
    // two queries for the whole batch. Non-blocking — collected as warnings for
    // the admin to review after the assignment lands. Service-category
    // mismatches ride along the same way: warn, never block.
    const evaluations = await evaluateEmployeeWindows(
      cleanerId,
      jobs.map((j) => windowFromInstants(j.startTime, j.endTime))
    );
    const warnings: string[] = [];
    // Per-job override notes, computed once and reused by the JobLog writes
    // below — the log used to recompute the same warning three times per row.
    const overrideNotes = jobs.map((j, i) => {
      const ev = evaluations[i];
      const availability = ev ? availabilityWarning(cleaner.name, ev) : null;
      const category = categoryMismatchWarning(
        cleaner.name,
        j.jobType,
        cleaner.allowedServiceCategories
      );
      if (availability) warnings.push(`Job #${j.jobNumber}: ${availability}`);
      if (category) warnings.push(`Job #${j.jobNumber}: ${category}`);
      const parts: string[] = [];
      if (availability) parts.push(`availability conflict overridden (${availability})`);
      if (category) parts.push(`service category mismatch overridden (${category})`);
      return parts.length ? ` — ${parts.join("; ")}` : "";
    });

    await db.$transaction(async (tx) => {
      for (const j of jobs) {
        await tx.job.update({
          where: { id: j.id },
          data: {
            cleaners: { connect: { id: cleanerId } },
            ...(j.employeeId ? {} : { employeeId: cleanerId }),
          },
        });
      }
      // Per-cleaner assignment status row (item 9) — idempotent upsert.
      for (const j of jobs) {
        await tx.jobAssignment.upsert({
          where: { jobId_cleanerId: { jobId: j.id, cleanerId } },
          update: {},
          create: { jobId: j.id, cleanerId, status: "ASSIGNED" },
        });
      }
      for (const [i, j] of jobs.entries()) {
        await tx.jobLog.create({
          data: {
            jobId: j.id,
            userId: gate.userId,
            action: "UPDATED",
            field: "cleaners",
            description: `Cleaner assigned via bulk action by ${gate.userName}${overrideNotes[i]}`,
          },
        });
      }
    });

    revalidatePath("/admin/jobs");
    return { success: true, count: jobs.length, warnings };
  } catch (e) {
    console.error("bulkAssignCleaner", e);
    return { success: false, error: "Failed to assign cleaner" };
  }
}
