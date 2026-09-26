"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";

import { actorFromSession } from "@/server/actor";
import { revalidateAfterTraining } from "@/server/training/revalidate";
import { submitQuizFor } from "@/server/training/training";

interface SubmitQuizInput {
  moduleId: string;
  answers: { quizId: string; selectedIndex: number }[];
}

/**
 * Submit a quiz. Marking lives in server/training/training.ts, shared with the
 * phone's POST /api/v1/training/:moduleId/quiz. Stricter than this action used
 * to be: every question must be answered exactly once (the quiz page always
 * does), an inactive module is refused, and three failed attempts in a row
 * are followed by a 24-hour wait.
 */
export async function submitQuiz(input: SubmitQuizInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false as const, error: "Not authenticated" };

    if (!input.moduleId || typeof input.moduleId !== "string") {
      return { success: false as const, error: "Module id is required" };
    }
    const answers = Array.isArray(input.answers) ? input.answers.slice(0, 200) : [];

    const result = await submitQuizFor(
      actorFromSession(session.user as { id: string; name?: string | null; email: string; role?: string | null }),
      {
        moduleId: input.moduleId,
        answers: answers.map((a) => ({ questionId: String(a?.quizId ?? ""), selectedIndex: Number(a?.selectedIndex) })),
        now: new Date(),
      },
    );
    if (!result.ok) return { success: false as const, error: result.message };

    revalidateAfterTraining(input.moduleId);
    const { score, passed, correct, total } = result.value;
    return { success: true as const, score, passed, correct, total };
  } catch (error) {
    console.error("Error submitting quiz:", error);
    return { success: false as const, error: "Failed to submit quiz" };
  }
}
