"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Admin side of the "respond to requests" channel (decision D4). Deliberately
 * separate from JobApplication.notes, which the inbox UI already frames as a
 * private, admin-only note — this is visible to the applicant in their
 * portal, so nothing written here should be internal commentary.
 */
export async function postAdminMessageToApplicant(input: {
  applicationId: string;
  body: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  const text = input.body?.trim();
  if (!text) return { success: false, error: "Message can't be empty" };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { success: false, error: "Message is too long" };
  }

  const application = await db.jobApplication.findUnique({
    where: { id: input.applicationId },
    select: { id: true },
  });
  if (!application) return { success: false, error: "Application not found" };

  await db.applicantMessage.create({
    data: {
      jobApplicationId: application.id,
      authorRole: "ADMIN",
      authorUserId: session.user.id,
      body: text,
    },
  });

  revalidatePath("/admin/job-applications");
  revalidatePath("/applicant");
  return { success: true };
}
