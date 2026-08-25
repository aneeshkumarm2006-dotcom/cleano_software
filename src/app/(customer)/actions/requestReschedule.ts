"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { sendAdminBookingPostpone } from "@/lib/email";

export async function requestReschedule(input: {
  jobId: string;
  preferredDate?: string;
  notes?: string;
}) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    const email = session.user.email?.toLowerCase();
    if (!email) return { success: false, error: "Session has no email" };

    const job = await db.job.findUnique({
      where: { id: input.jobId },
      include: { client: { select: { email: true } } },
    });
    if (!job) return { success: false, error: "Booking not found" };
    if (job.client?.email !== email) {
      return { success: false, error: "Not authorized" };
    }

    const noteParts: string[] = ["Reschedule requested by client"];
    if (input.preferredDate)
      noteParts.push(`Preferred date: ${input.preferredDate}`);
    if (input.notes?.trim()) noteParts.push(input.notes.trim());

    await db.$transaction([
      db.job.update({
        where: { id: input.jobId },
        data: { rescheduleRequestedAt: new Date() },
      }),
      db.jobLog.create({
        data: {
          jobId: input.jobId,
          userId: session.user.id,
          action: "NOTE_ADDED",
          description: noteParts.join(" · "),
        },
      }),
    ]);

    // Notify all admins (gated).
    sendAdminBookingPostpone({
      jobId: input.jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      startTime: job.startTime.toISOString(),
      address: job.location ?? "",
      serviceType: job.jobType,
    }).catch((e) => console.error("admin postpone email", e));

    revalidatePath("/");
    revalidatePath("/bookings");
    return { success: true };
  } catch (error) {
    console.error("Error requesting reschedule:", error);
    return { success: false, error: "Failed to submit request" };
  }
}
