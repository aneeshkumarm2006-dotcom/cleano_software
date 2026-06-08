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

  await db.jobApplication.update({
    where: { id: input.applicationId },
    data: {
      status: input.status,
      ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
    },
  });

  revalidatePath("/job-applications");
  return { success: true };
}
