"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Generate (or fetch existing) job checklist for the current employee.
 *
 * Combines templates matching the job's `jobType` (plus templates with no
 * jobType — i.e. always-applies "standard" templates) with templates whose
 * `addOnName` matches one of the job's add-ons. Items from each matching
 * template are flattened into a single JobChecklist for this employee.
 *
 * Idempotent: if a checklist already exists for (jobId, employeeId), returns
 * it unchanged.
 */
export async function generateJobChecklist(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false as const, error: "Not authenticated" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        cleaners: { select: { id: true } },
        addOns: true,
      },
    });

    if (!job) return { success: false as const, error: "Job not found" };

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some((c) => c.id === session.user.id);

    if (!isAdmin && !isEmployee && !isCleaner) {
      return { success: false as const, error: "Not authorized for this job" };
    }

    const existing = await db.jobChecklist.findFirst({
      where: { jobId, employeeId: session.user.id },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        template: true,
      },
    });
    if (existing) {
      return { success: true as const, checklistId: existing.id };
    }

    const addOnNames = job.addOns.map((a) => a.name);

    const templates = await db.checklistTemplate.findMany({
      where: {
        isActive: true,
        OR: [
          { jobType: job.jobType ?? null },
          { jobType: null, addOnName: null },
          ...(addOnNames.length > 0
            ? [{ addOnName: { in: addOnNames } }]
            : []),
        ],
      },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
      },
    });

    const checklist = await db.jobChecklist.create({
      data: {
        jobId,
        employeeId: session.user.id,
        templateId: null,
        items: {
          create: templates.flatMap((tpl, tplIdx) =>
            tpl.items.map((item, itemIdx) => ({
              title: item.title,
              description: item.description,
              isRequired: item.isRequired,
              sortOrder: tplIdx * 1000 + (item.sortOrder ?? itemIdx),
            }))
          ),
        },
      },
    });

    revalidatePath(`/cleaners/my-jobs/${jobId}`);
    return { success: true as const, checklistId: checklist.id };
  } catch (error) {
    console.error("Error generating job checklist:", error);
    return { success: false as const, error: "Failed to generate checklist" };
  }
}
