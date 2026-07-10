"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { smsOnTheWay } from "@/lib/sms";
import { sendAdminOnTheWay } from "@/lib/email";
import { setAssignmentProgress } from "@/lib/job-assignments";
import { getSetting } from "@/lib/settings";

/** Default ETA (minutes) advertised to the customer when the cleaner taps
 *  "On my way". We don't run a maps SDK — this mirrors the catalog's default
 *  15-minute "on the way" threshold. */
const DEFAULT_ETA_MIN = 15;

/**
 * Marks the caller as "on the way" for a job, before clock-in.
 * Idempotent-ish: if `onMyWayAt` is already set we return the existing
 * timestamp without overwriting it or re-notifying the customer.
 */
export async function markOnMyWay(
  jobId: string,
  coords?: { lat: number; lng: number }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" as const };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        employee: true,
        cleaners: true,
        client: { select: { phone: true } },
      },
    });

    if (!job) {
      return { success: false, error: "Job not found" as const };
    }

    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some((c) => c.id === session.user.id);
    if (!isEmployee && !isCleaner) {
      return { success: false, error: "You are not assigned to this job" as const };
    }

    // Already marked — don't overwrite or re-notify. Still record THIS
    // cleaner's per-assignment status (a teammate may have set the job-level
    // flag first on a multi-cleaner job).
    if (job.onMyWayAt) {
      if (!job.clockInTime) {
        await setAssignmentProgress(jobId, session.user.id, {
          status: "ON_THE_WAY",
          onMyWayAt: new Date(),
        });
      }
      return { success: true, onMyWayAt: job.onMyWayAt.toISOString(), alreadySet: true };
    }

    const now = new Date();

    // Live GPS tracking (#10) is admin-gated. When off, we still record the
    // "On my way" status but never store coordinates.
    const gpsEnabled = await getSetting("tracking.gpsEnabled");

    await db.job.update({
      where: { id: jobId },
      data: {
        onMyWayAt: now,
        ...(gpsEnabled && coords
          ? {
              onMyWayLat: coords.lat,
              onMyWayLng: coords.lng,
              onMyWayLocationAt: now,
            }
          : {}),
      },
    });

    // Per-cleaner assignment status (item 9).
    await setAssignmentProgress(jobId, session.user.id, {
      status: "ON_THE_WAY",
      onMyWayAt: now,
    });

    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "NOTE_ADDED",
        description: `${session.user.name ?? "Cleaner"} is on the way${
          gpsEnabled && coords ? " (location shared)" : ""
        }`,
      },
    });

    // Customer SMS — gated by `cust.booking.on_the_way` inside smsOnTheWay
    // AND the per-booking notifyClient toggle.
    const phone = job.notifyClient ? job.client?.phone : null;
    if (phone) {
      smsOnTheWay({
        to: phone,
        cleanerName: session.user.name ?? "Your cleaner",
        etaMin: DEFAULT_ETA_MIN,
      }).catch((e) => console.error("on-the-way customer sms", e));
    }

    // Admin notification — gated by `admin.clock.on_the_way`.
    sendAdminOnTheWay({
      jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      cleanerName: session.user.name ?? "Cleaner",
    }).catch((e) => console.error("admin on-the-way email", e));

    revalidatePath("/cleaners/my-jobs");
    revalidatePath(`/cleaners/my-jobs/${jobId}`);
    revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
    revalidatePath(`/admin/jobs/${jobId}`);

    return { success: true, onMyWayAt: now.toISOString() };
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
