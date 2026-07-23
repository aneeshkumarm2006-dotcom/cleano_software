"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { normalizeJobType } from "@/lib/calendar-labels";

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

    // Templates are stored with the admin jobType vocabulary ("R - Residential",
    // "DEEP - Deep Cleaning", "MOVE_IN - …"), but web bookings store the raw
    // service type ("STANDARD", "DEEP", "MOVE_IN_OUT"). Matching by exact string
    // meant service-type checklists NEVER attached to web-booked jobs. Match on
    // the NORMALIZED category instead so both vocabularies line up. A combined
    // MOVE_IN_OUT job pulls in both the Move-in and Move-out templates.
    const jobCategory = normalizeJobType(job.jobType);
    const wantedCategories = new Set(
      jobCategory === "MOVE_IN_OUT"
        ? ["MOVE_IN_OUT", "MOVE_IN", "MOVE_OUT"]
        : jobCategory
          ? [jobCategory]
          : []
    );

    const candidateTemplates = await db.checklistTemplate.findMany({
      where: {
        isActive: true,
        OR: [
          { jobType: { not: null } }, // service-type templates (filtered below)
          { jobType: null, addOnName: null }, // global "always applies"
          ...(addOnNames.length > 0
            ? [{ addOnName: { in: addOnNames } }]
            : []),
        ],
      },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
      },
    });

    // Keep: globals (no jobType) — but only when they aren't add-on-scoped to a
    // different add-on; add-on templates whose add-on is on the job; and
    // service-type templates whose normalized category matches the job.
    const templates = candidateTemplates.filter((t) => {
      if (t.jobType) return wantedCategories.has(normalizeJobType(t.jobType) ?? "");
      if (t.addOnName) return addOnNames.includes(t.addOnName);
      return true; // global template
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
