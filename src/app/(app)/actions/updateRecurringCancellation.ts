"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Admin maintenance for a recurring-cancellation record. Replies arrive in the
 * shared inbox (not auto-detectable), so admins mark them here; they can also
 * override the offer status.
 */
export async function updateRecurringCancellation(input: {
  id: string;
  markReplied?: boolean;
  offerStatus?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }
  if (!input.id) return { success: false, error: "Missing id" };

  const data: {
    repliedAt?: Date | null;
    offerStatus?: string;
  } = {};
  if (input.markReplied === true) {
    data.repliedAt = new Date();
    data.offerStatus = "REPLIED";
  } else if (input.markReplied === false) {
    data.repliedAt = null;
  }
  if (input.offerStatus) data.offerStatus = input.offerStatus;

  await db.recurringCancellation.update({ where: { id: input.id }, data });

  revalidatePath("/kpi");
  revalidatePath("/analytics");
  return { success: true };
}
