"use server";

// "Save this as a template" — the second half of the Sept 17 list's item 18.
//
// Item 18 shipped the one-off checklist: type steps straight onto a job when no
// template fits. The sub-bullet it deliberately left was reuse, and leaving it
// is what makes the feature quietly expensive — the first person to type a
// fifteen-step move-out list types it again for the next move-out, and the two
// lists drift.
//
// This does NOT touch the job. The one-off list stays exactly as it is and the
// job keeps using it; a template is a copy taken at this moment, so editing the
// job later does not silently rewrite a template other jobs now depend on. That
// direction matters: a template is shared, and shared things must not change
// under people who did not ask.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/org-db";
import { requireOrgId } from "@/lib/org";
import { isAdminRole } from "@/lib/role-routing";
import { logActivity } from "@/lib/activity-log";
import {
  checkTemplateName,
  parseCustomChecklist,
  templateItemsFrom,
} from "@/lib/job-checklist";

type Result =
  | { success: true; templateId: string; itemCount: number }
  | { success: false; error: string };

export async function saveChecklistAsTemplate(input: {
  jobId: string;
  name: string;
  /** Limit the template to this job's client, rather than every client. */
  scopeToClient?: boolean;
  /** Limit it to this job's service type, rather than every service. */
  scopeToJobType?: boolean;
}): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  if (!isAdminRole((session.user as { role?: string }).role)) {
    return { success: false, error: "Not authorized" };
  }

  const named = checkTemplateName(input.name);
  if (!named.ok) return { success: false, error: named.error };

  if (typeof input.jobId !== "string" || !input.jobId) {
    return { success: false, error: "Invalid request" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        clientId: true,
        clientName: true,
        customChecklist: true,
      },
    });
    if (!job) return { success: false, error: "That booking no longer exists." };

    const items = parseCustomChecklist(job.customChecklist);
    if (items.length === 0) {
      return {
        success: false,
        error: "This booking has no one-off checklist to save.",
      };
    }

    // Scoping to a client is only meaningful when the job HAS one. Silently
    // producing a global template from a request to scope it would be the
    // worst outcome available: a strict customer list firing on every job.
    const wantsClient = input.scopeToClient === true;
    if (wantsClient && !job.clientId) {
      return {
        success: false,
        error: "This booking isn't linked to a client, so it can't be saved for one.",
      };
    }
    const clientId = wantsClient ? job.clientId : null;
    const jobType = input.scopeToJobType === true ? job.jobType ?? null : null;

    const organizationId = await requireOrgId();

    // A duplicate name is not an error the database will catch, and two
    // templates called "Move out" are indistinguishable in the picker they
    // both appear in.
    const clash = await db.checklistTemplate.findFirst({
      where: { name: named.name, isActive: true },
      select: { id: true },
    });
    if (clash) {
      return {
        success: false,
        error: `There's already a template called "${named.name}". Pick another name.`,
      };
    }

    // One transaction: a template with no items is worse than no template,
    // because it matches jobs and then gives the cleaner an empty list.
    // The callback form, not the array form — the tenant client rejects the
    // latter.
    const templateId = await db.$transaction(async (tx) => {
      const tpl = await tx.checklistTemplate.create({
        data: {
          organizationId,
          name: named.name,
          jobType,
          clientId,
          description: `Saved from booking #${job.jobNumber}.`,
          isActive: true,
        },
        select: { id: true },
      });
      await tx.checklistTemplateItem.createMany({
        data: templateItemsFrom(items).map((it) => ({
          ...it,
          organizationId,
          templateId: tpl.id,
        })),
      });
      return tpl.id;
    });

    await logActivity({
      category: "ADMIN",
      action: "checklist.template.saved_from_job",
      status: "SUCCESS",
      targetType: "Job",
      targetId: job.id,
      message:
        `${session.user.name ?? "An admin"} saved the one-off checklist on job #${job.jobNumber} ` +
        `as a template called "${named.name}" (${items.length} step${items.length === 1 ? "" : "s"})` +
        (clientId ? `, limited to ${job.clientName ?? "that client"}` : "") +
        (jobType ? `, limited to ${jobType} jobs` : "") +
        ".",
    }).catch(() => {});

    revalidatePath("/admin/settings");
    revalidatePath(`/admin/jobs/${job.id}`);
    return { success: true, templateId, itemCount: items.length };
  } catch (e) {
    console.error("saveChecklistAsTemplate", e);
    return {
      success: false,
      error: "Couldn't save that template. The booking's checklist is unchanged.",
    };
  }
}
