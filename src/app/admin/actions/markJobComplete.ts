"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { ensureRatingRequest } from "@/lib/rating";
import { isAdminRole } from "@/lib/role-routing";
import { advanceContactLifecycleForBooking } from "@/lib/crm";

export async function markJobComplete(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" };

  // Only an admin or a cleaner assigned to this job may complete it.
  const role = (session.user as { role?: string }).role;
  const userId = session.user.id;
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { employeeId: true, clientId: true, cleaners: { select: { id: true } } },
  });
  if (!job) return { error: "Job not found" };
  const isAssigned =
    job.employeeId === userId || job.cleaners.some((c) => c.id === userId);
  if (!isAdminRole(role) && !isAssigned) {
    return { error: "Not authorized" };
  }

  await db.job.update({
    where: { id: jobId },
    data: { status: "COMPLETED" },
  });

  // Per-cleaner assignment status (item 9): cleaners who worked the job
  // (clocked in/out) are marked COMPLETED when the job closes.
  await db.jobAssignment
    .updateMany({
      where: { jobId, status: { in: ["CLOCKED_IN", "CLOCKED_OUT"] } },
      data: { status: "COMPLETED" },
    })
    .catch((e) => console.error("markJobComplete assignments", e));

  // §7: advance the CRM contact lifecycle (→ ACTIVE / RETURNING).
  if (job.clientId) {
    await advanceContactLifecycleForBooking(job.clientId, "BOOKING_COMPLETED");
  }

  // Ask the customer to rate the cleaning (auto-email + portal pop-up token).
  await ensureRatingRequest(jobId).catch((e) =>
    console.error("ensureRatingRequest", e)
  );

  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin/jobs");
  return { success: true };
}
