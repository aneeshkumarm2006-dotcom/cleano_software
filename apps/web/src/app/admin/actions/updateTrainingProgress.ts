"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";

import { actorFromSession } from "@/server/actor";
import { revalidateAfterTraining } from "@/server/training/revalidate";
import { setTrainingProgressFor } from "@/server/training/training";

interface UpdateTrainingProgressInput {
  moduleId: string;
  videoProgress?: number;
  markComplete?: boolean;
}

/**
 * Record video progress, or mark a module watched. The rules live in
 * server/training/training.ts, shared with the phone's
 * POST /api/v1/training/:moduleId/progress. Two are stricter than this action
 * used to be: an inactive module is refused, and progress only ever goes up.
 * The progress is stored as self-attested.
 */
export async function updateTrainingProgress(input: UpdateTrainingProgressInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    if (!input.moduleId || typeof input.moduleId !== "string") {
      return { success: false, error: "Module id is required" };
    }

    const result = await setTrainingProgressFor(
      actorFromSession(session.user as { id: string; name?: string | null; email: string; role?: string | null }),
      {
        moduleId: input.moduleId,
        videoProgress: typeof input.videoProgress === "number" ? input.videoProgress : undefined,
        markComplete: input.markComplete === true,
        now: new Date(),
      },
    );
    if (!result.ok) return { success: false, error: result.message };

    revalidateAfterTraining(input.moduleId);
    return { success: true, progress: result.value };
  } catch (error) {
    console.error("Error updating training progress:", error);
    return { success: false, error: "Failed to update progress" };
  }
}
