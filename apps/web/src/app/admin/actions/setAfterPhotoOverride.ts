"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Admin override for after-photo consent. When the customer didn't consent at
 * booking, an OWNER/ADMIN can still authorise after-photos for a single job
 * (e.g. the customer verbally agreed). Clearing it revokes that authorisation.
 */
export async function setAfterPhotoOverride(jobId: string, enabled: boolean) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  if (!jobId) return { success: false, error: "Missing jobId" };

  await db.job.update({
    where: { id: jobId },
    data: enabled
      ? { afterPhotoOverrideAt: new Date(), afterPhotoOverrideBy: session.user.id }
      : { afterPhotoOverrideAt: null, afterPhotoOverrideBy: null },
  });

  await db.jobLog.create({
    data: {
      jobId,
      userId: session.user.id,
      action: "UPDATED",
      field: "afterPhotoOverride",
      newValue: enabled ? "enabled" : "cleared",
      description: `${session.user.name ?? "Admin"} ${
        enabled ? "enabled" : "cleared"
      } the after-photo override`,
    },
  });

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: true };
}

/**
 * Spec item 21: after-photos are allowed by default; this is the per-job
 * OPT-OUT. Disabling clears any override too, so the job is unambiguously off.
 */
export async function setAfterPhotosEnabled(jobId: string, enabled: boolean) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }
  if (!jobId) return { success: false, error: "Missing jobId" };

  await db.job.update({
    where: { id: jobId },
    data: enabled
      ? { afterPhotoConsent: true }
      : {
          afterPhotoConsent: false,
          afterPhotoOverrideAt: null,
          afterPhotoOverrideBy: null,
        },
  });

  await db.jobLog.create({
    data: {
      jobId,
      userId: session.user.id,
      action: "UPDATED",
      field: "afterPhotos",
      newValue: enabled ? "enabled" : "disabled",
      description: `${session.user.name ?? "Admin"} ${
        enabled ? "enabled" : "disabled"
      } after-photos for this job`,
    },
  });

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: true };
}
