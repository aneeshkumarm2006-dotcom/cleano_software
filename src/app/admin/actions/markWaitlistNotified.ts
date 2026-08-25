"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { formatDate } from "@/lib/timezone";

export async function markWaitlistNotified(id: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const entry = await db.waitlist.findUnique({ where: { id } });
    if (!entry) return { success: false, error: "Not found" };
    if (entry.status === "NOTIFIED") {
      return { success: false, error: "Already notified" };
    }

    await db.$transaction([
      db.waitlist.update({
        where: { id },
        data: { status: "NOTIFIED", notifiedAt: new Date() },
      }),
      db.emailLog.create({
        data: {
          kind: "WAITLIST_AVAILABLE",
          recipient: entry.email,
          subject: `Slot opened up for ${formatDate(entry.preferredDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`,
          status: "PENDING",
          waitlistId: id,
        },
      }),
    ]);

    revalidatePath("/admin/waitlist");
    return { success: true };
  } catch (error) {
    console.error("Error notifying waitlist entry:", error);
    return { success: false, error: "Failed to notify" };
  }
}
