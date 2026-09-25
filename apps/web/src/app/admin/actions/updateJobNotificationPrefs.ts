"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Per-booking notification controls (client-fixes item 15). Toggles whether
 * job-scoped client (email/SMS) and provider (email/app-push/invite) sends
 * fire for THIS job. Global NotificationSetting toggles still apply on top.
 */
export async function updateJobNotificationPrefs(
  jobId: string,
  prefs: { notifyClient?: boolean; notifyProvider?: boolean }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  if (
    typeof prefs.notifyClient !== "boolean" &&
    typeof prefs.notifyProvider !== "boolean"
  ) {
    return { success: false, error: "Nothing to update" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: { id: true, notifyClient: true, notifyProvider: true },
    });
    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const data: { notifyClient?: boolean; notifyProvider?: boolean } = {};
    const changes: string[] = [];
    if (
      typeof prefs.notifyClient === "boolean" &&
      prefs.notifyClient !== job.notifyClient
    ) {
      data.notifyClient = prefs.notifyClient;
      changes.push(`client notifications ${prefs.notifyClient ? "on" : "off"}`);
    }
    if (
      typeof prefs.notifyProvider === "boolean" &&
      prefs.notifyProvider !== job.notifyProvider
    ) {
      data.notifyProvider = prefs.notifyProvider;
      changes.push(
        `provider notifications ${prefs.notifyProvider ? "on" : "off"}`
      );
    }

    if (changes.length === 0) {
      return {
        success: true,
        notifyClient: job.notifyClient,
        notifyProvider: job.notifyProvider,
      };
    }

    const [updated] = await db.$transaction(async (tx) => {
      const __t0 = await tx.job.update({
          where: { id: jobId },
          data,
          select: { notifyClient: true, notifyProvider: true },
        });
      const __t1 = await tx.jobLog.create({
          data: {
            jobId,
            userId: session.user.id,
            action: "UPDATED",
            field: "notificationPrefs",
            description: `Notification settings changed by ${
              session.user.name ?? "Admin"
            } — ${changes.join(", ")}`,
          },
        });
      return [__t0, __t1];
    });

    revalidatePath(`/admin/jobs/${jobId}`);
    return {
      success: true,
      notifyClient: updated.notifyClient,
      notifyProvider: updated.notifyProvider,
    };
  } catch (error) {
    console.error("Error updating job notification prefs:", error);
    return { success: false, error: "Failed to update notification settings" };
  }
}
