"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface UpdateTrainingProgressInput {
  moduleId: string;
  videoProgress?: number;
  markComplete?: boolean;
}

export async function updateTrainingProgress(
  input: UpdateTrainingProgressInput
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    const employeeId = session.user.id;
    const { moduleId } = input;

    if (!moduleId) {
      return { success: false, error: "Module id is required" };
    }

    const moduleRow = await db.trainingModule.findUnique({
      where: { id: moduleId },
      include: { quizzes: { select: { id: true } } },
    });
    if (!moduleRow) return { success: false, error: "Module not found" };

    const existing = await db.trainingProgress.findUnique({
      where: { moduleId_employeeId: { moduleId, employeeId } },
    });

    const clampedProgress =
      input.videoProgress !== undefined
        ? Math.min(1, Math.max(0, input.videoProgress))
        : undefined;

    const hasQuiz = moduleRow.quizzes.length > 0;
    const previousScore = existing?.quizScore ?? null;

    const data: {
      videoProgress?: number;
      status?: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
      completedAt?: Date | null;
    } = {};

    if (clampedProgress !== undefined) {
      data.videoProgress = clampedProgress;
      if (clampedProgress > 0 && (!existing || existing.status === "NOT_STARTED")) {
        data.status = "IN_PROGRESS";
      }
    }

    if (input.markComplete) {
      const videoOk =
        clampedProgress !== undefined ? clampedProgress >= 0.9 : (existing?.videoProgress ?? 0) >= 0.9;
      if (!videoOk) {
        return { success: false, error: "Watch at least 90% to mark complete" };
      }
      if (!hasQuiz) {
        data.status = "COMPLETED";
        data.completedAt = new Date();
      } else if (previousScore !== null && previousScore >= 0.8) {
        data.status = "COMPLETED";
        data.completedAt = new Date();
      } else {
        data.status = existing?.status === "FAILED" ? "FAILED" : "IN_PROGRESS";
      }
    }

    const progress = await db.trainingProgress.upsert({
      where: { moduleId_employeeId: { moduleId, employeeId } },
      update: data,
      create: {
        moduleId,
        employeeId,
        videoProgress: clampedProgress ?? 0,
        status: data.status ?? "IN_PROGRESS",
      },
    });

    revalidatePath("/admin/training");
    revalidatePath(`/admin/training/${moduleId}`);
    return { success: true, progress };
  } catch (error) {
    console.error("Error updating training progress:", error);
    return { success: false, error: "Failed to update progress" };
  }
}
