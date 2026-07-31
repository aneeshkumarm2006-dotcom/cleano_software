"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

/**
 * Counts pending customer-portal requests (cancellation + reschedule).
 * Used to render the badge on the Requests sidebar item.
 *
 * `resolveJobRequest` clears the `*RequestedAt` field on approve/deny, so
 * counting "field still set" naturally gives just the pending ones.
 */
export async function getPendingRequestCount(): Promise<{ count: number }> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { count: 0 };
    const role = (session.user as { role?: string }).role;
    const isAdmin =
      role === "OWNER" ||
      role === "ADMIN" ||
      role === "OPS_MANAGER" ||
      role === "FIELD_LEAD";
    if (!isAdmin) return { count: 0 };

    const count = await db.job.count({
      where: {
        // Matches the Requests page — archived jobs excluded (item 1).
        deletedAt: null,
        OR: [
          { cancellationRequestedAt: { not: null } },
          { rescheduleRequestedAt: { not: null } },
        ],
      },
    });

    return { count };
  } catch {
    return { count: 0 };
  }
}
