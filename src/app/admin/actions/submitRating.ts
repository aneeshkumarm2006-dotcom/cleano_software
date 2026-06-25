"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { recalculateMultiplier } from "./recalculateMultiplier";

interface SubmitRatingInput {
  employeeId: string;
  rating: number;
  jobId?: string | null;
  notes?: string | null;
}

export async function submitRating(input: SubmitRatingInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    if (!isAdmin) {
      return { success: false, error: "Not authorized" };
    }

    if (!input.employeeId) {
      return { success: false, error: "Employee is required" };
    }

    if (
      typeof input.rating !== "number" ||
      input.rating < 1 ||
      input.rating > 5
    ) {
      return { success: false, error: "Rating must be between 1 and 5" };
    }

    const employee = await db.user.findUnique({
      where: { id: input.employeeId },
    });
    if (!employee) {
      return { success: false, error: "Employee not found" };
    }

    if (input.jobId) {
      const job = await db.job.findUnique({ where: { id: input.jobId } });
      if (!job) {
        return { success: false, error: "Job not found" };
      }
    }

    const rating = await db.employeeRating.create({
      data: {
        employeeId: input.employeeId,
        jobId: input.jobId ?? null,
        rating: input.rating,
        notes: input.notes ?? null,
        ratedBy: session.user.id,
      },
    });

    const recalc = await recalculateMultiplier({ employeeId: input.employeeId });

    revalidatePath("/admin/settings");
    revalidatePath(`/admin/employees/${input.employeeId}`);
    if (input.jobId) {
      revalidatePath(`/cleaners/my-jobs/${input.jobId}`);
      revalidatePath(`/admin/jobs/${input.jobId}`);
    }

    return { success: true, rating, recalc };
  } catch (error) {
    console.error("Error submitting rating:", error);
    return { success: false, error: "Failed to submit rating" };
  }
}
