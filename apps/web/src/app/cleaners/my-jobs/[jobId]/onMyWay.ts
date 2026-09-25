"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOrgId } from "@/lib/org";
import { actorFromSession } from "@/server/actor";
import { fireEffects } from "@/server/effects";
import { markOnMyWayFor } from "@/server/on-my-way/on-my-way";
import { getSetting } from "@/lib/settings";
import { isStaffRole } from "@/lib/role-routing";

/**
 * Marks the caller as "on the way" for a job, before clock-in.
 * Idempotent-ish: if `onMyWayAt` is already set we return the existing
 * timestamp without overwriting it or re-notifying the customer. The rules
 * live in server/on-my-way/on-my-way.ts, shared with the phone.
 */
export async function markOnMyWay(
  jobId: string,
  coords?: { lat: number; lng: number }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" as const };
  }
  if (!isStaffRole((session.user as { role?: string }).role)) {
    return { success: false, error: "Not authorized" as const };
  }

  try {
    const actor = actorFromSession(
      session.user as { id: string; name?: string | null; email: string; role?: string | null },
      await requireOrgId(),
    );
    const result = await markOnMyWayFor(actor, { jobId, coords, now: new Date(), door: "web" });
    if (!result.ok) {
      return {
        success: false,
        error:
          result.code === "NOT_ON_JOB"
            ? ("You are not assigned to this job" as const)
            : ("Job not found" as const),
      };
    }

    // Already marked by someone: nobody was notified again.
    if (result.value.jobAlreadySet) {
      return { success: true, onMyWayAt: result.value.jobOnMyWayAt, alreadySet: true };
    }

    fireEffects(result.effects);

    revalidatePath("/cleaners/my-jobs");
    revalidatePath(`/cleaners/my-jobs/${jobId}`);
    revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
    revalidatePath(`/admin/jobs/${jobId}`);

    return { success: true, onMyWayAt: result.value.jobOnMyWayAt };
  } catch (error) {
    console.error("Error marking on the way:", error);
    return { success: false, error: "Failed to mark on the way" as const };
  }
}

/**
 * Periodic live-location update while the cleaner is en route (basic GPS, #10).
 * Only updates the stored location while the cleaner is on the way and has NOT
 * yet clocked in — tracking stops automatically after clock-in/clock-out. No
 * maps SDK; admin views the last point via a map link on the job page.
 */
export async function updateOnMyWayLocation(
  jobId: string,
  coords: { lat: number; lng: number }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" as const };
  }
  if (!isStaffRole((session.user as { role?: string }).role)) {
    return { success: false, error: "Not authorized" as const };
  }

  // Live GPS tracking (#10) is admin-gated. When off, silently no-op so a stray
  // in-flight poll (e.g. from a screen open when the setting flipped) never
  // stores a location.
  const gpsEnabled = await getSetting("tracking.gpsEnabled");
  if (!gpsEnabled) {
    return { success: true as const, skipped: true as const };
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      employeeId: true,
      onMyWayAt: true,
      clockInTime: true,
      clockOutTime: true,
      cleaners: { select: { id: true } },
    },
  });
  if (!job) return { success: false, error: "Job not found" as const };

  const isEmployee = job.employeeId === session.user.id;
  const isCleaner = job.cleaners.some((c) => c.id === session.user.id);
  if (!isEmployee && !isCleaner) {
    return { success: false, error: "You are not assigned to this job" as const };
  }

  // Tracking window is only active between "on my way" and clock-in.
  if (!job.onMyWayAt || job.clockInTime || job.clockOutTime) {
    return { success: false, error: "Tracking window closed" as const };
  }

  await db.job.update({
    where: { id: jobId },
    data: {
      onMyWayLat: coords.lat,
      onMyWayLng: coords.lng,
      onMyWayLocationAt: new Date(),
    },
  });

  return { success: true as const };
}
