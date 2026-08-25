"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isApplicantRole } from "@/lib/role-routing";

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Applicant side of the "respond to requests" channel (decision D4).
 * Deliberately separate from JobApplication.notes, which stays private and
 * admin-only. SELF-SCOPED: resolves the applicant's own application from the
 * session, never from a caller-supplied id.
 */
export async function postApplicantMessage(body: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (!isApplicantRole(role)) return { success: false, error: "Not authorized" };

  const text = body?.trim();
  if (!text) return { success: false, error: "Message can't be empty" };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { success: false, error: "Message is too long" };
  }

  const application = await db.jobApplication.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!application) return { success: false, error: "Application not found" };

  await db.applicantMessage.create({
    data: {
      jobApplicationId: application.id,
      authorRole: "APPLICANT",
      authorUserId: session.user.id,
      body: text,
    },
  });

  revalidatePath("/applicant");
  revalidatePath("/admin/job-applications");
  return { success: true };
}
