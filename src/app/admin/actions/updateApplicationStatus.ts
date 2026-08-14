"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { JobApplicationStatus } from "@prisma/client";

export async function updateApplicationStatus(input: {
  applicationId: string;
  status: JobApplicationStatus;
  notes?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  const application = await db.jobApplication.update({
    where: { id: input.applicationId },
    data: {
      status: input.status,
      ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
    },
    select: { userId: true },
  });

  // Rejected/archived applicants lose portal access (decision D4); moving an
  // application back off either status restores it. `role: "APPLICANT"` in
  // the where clause means a converted EMPLOYEE is never toggled by this —
  // once hired, the application's status no longer governs their login.
  if (application.userId) {
    const blocked = input.status === "REJECTED" || input.status === "ARCHIVED";
    await db.user.updateMany({
      where: { id: application.userId, role: "APPLICANT" },
      data: { isActive: !blocked },
    });
  }

  revalidatePath("/admin/job-applications");
  revalidatePath("/applicant");
  return { success: true };
}
