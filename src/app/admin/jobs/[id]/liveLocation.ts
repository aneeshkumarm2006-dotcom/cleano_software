"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getSetting } from "@/lib/settings";

export interface LiveLocation {
  lat: number;
  lng: number;
  /** ISO timestamp of the last stored point. */
  at: string;
}

export type LiveLocationResult =
  | { success: true; location: LiveLocation | null }
  | { success: false; error: string };

/**
 * Admin-gated poll target for the live "on the way" map (#10). Returns the
 * cleaner's last shared point while the job is en route (onMyWayAt set, not yet
 * clocked in) and GPS tracking is enabled. Fails closed: any missing session,
 * non-admin caller, disabled setting, or closed window returns no location.
 */
export async function getJobLiveLocation(
  jobId: string
): Promise<LiveLocationResult> {
  if (typeof jobId !== "string" || jobId.length === 0) {
    return { success: false, error: "Invalid request" };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "OWNER" && role !== "ADMIN")) {
    return { success: false, error: "Not authorized" };
  }

  // When the admin has disabled tracking, expose nothing.
  const gpsEnabled = await getSetting("tracking.gpsEnabled");
  if (!gpsEnabled) return { success: true, location: null };

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      onMyWayAt: true,
      clockInTime: true,
      clockOutTime: true,
      onMyWayLat: true,
      onMyWayLng: true,
      onMyWayLocationAt: true,
    },
  });
  if (!job) return { success: false, error: "Job not found" };

  // Only live while en route: on the way, not yet clocked in.
  const enRoute = !!job.onMyWayAt && !job.clockInTime && !job.clockOutTime;
  if (
    !enRoute ||
    job.onMyWayLat == null ||
    job.onMyWayLng == null
  ) {
    return { success: true, location: null };
  }

  return {
    success: true,
    location: {
      lat: job.onMyWayLat,
      lng: job.onMyWayLng,
      at: (job.onMyWayLocationAt ?? job.onMyWayAt ?? new Date()).toISOString(),
    },
  };
}
