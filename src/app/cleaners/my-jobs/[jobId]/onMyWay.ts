"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { smsOnTheWay } from "@/lib/sms";
import { sendAdminOnTheWay } from "@/lib/email";

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

    // Already marked — don't overwrite or re-notify.
    if (job.onMyWayAt) {
      return { success: true, onMyWayAt: job.onMyWayAt.toISOString(), alreadySet: true };
    }

    const now = new Date();

    await db.job.update({
      where: { id: jobId },
      data: {
        onMyWayAt: now,
        ...(coords
          ? {
              onMyWayLat: coords.lat,
              onMyWayLng: coords.lng,
              onMyWayLocationAt: now,
            }
          : {}),
      },
    });

    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "NOTE_ADDED",
        description: `${session.user.name ?? "Cleaner"} is on the way${
          coords ? " (location shared)" : ""
        }`,
      },
    });

    // Customer SMS — gated by `cust.booking.on_the_way` inside smsOnTheWay.
    const phone = job.client?.phone;
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
