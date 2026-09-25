"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface SubmitQuizInput {
  moduleId: string;
  answers: { quizId: string; selectedIndex: number }[];
}

interface QuizOption {
  text: string;
  isCorrect: boolean;
}

const PASS_THRESHOLD = 0.8;

export async function submitQuiz(input: SubmitQuizInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false as const, error: "Not authenticated" };
    const employeeId = session.user.id;

    if (!input.moduleId) {
      return { success: false as const, error: "Module id is required" };
    }

    const quizzes = await db.trainingQuiz.findMany({
      where: { moduleId: input.moduleId },
    });
    if (quizzes.length === 0) {
      return { success: false as const, error: "Module has no quiz" };
    }

    let correct = 0;
    for (const quiz of quizzes) {
      const answer = input.answers.find((a) => a.quizId === quiz.id);
      if (!answer) continue;
      const options = (quiz.options as unknown as QuizOption[]) || [];
      const opt = options[answer.selectedIndex];
      if (opt?.isCorrect) correct++;
    }
    const score = correct / quizzes.length;
    const passed = score >= PASS_THRESHOLD;

    const existing = await db.trainingProgress.findUnique({
      where: {
        moduleId_employeeId: {
          moduleId: input.moduleId,
          employeeId,
        },
      },
    });

    const videoProgress = existing?.videoProgress ?? 0;
    const passedVideo = videoProgress >= 0.9;

    const status: "COMPLETED" | "FAILED" | "IN_PROGRESS" = passed
      ? passedVideo
        ? "COMPLETED"
        : "IN_PROGRESS"
      : "FAILED";

    await db.trainingProgress.upsert({
      where: {
        moduleId_employeeId: {
          moduleId: input.moduleId,
          employeeId,
        },
      },
      update: {
        quizScore: score,
        quizAttempts: { increment: 1 },
        status,
        completedAt: status === "COMPLETED" ? new Date() : null,
      },
      create: {
        moduleId: input.moduleId,
        employeeId,
        quizScore: score,
        quizAttempts: 1,
        status,
        completedAt: status === "COMPLETED" ? new Date() : null,
      },
    });

    revalidatePath("/admin/training");
    revalidatePath(`/admin/training/${input.moduleId}`);
    return {
      success: true as const,
      score,
      passed,
      correct,
      total: quizzes.length,
    };
  } catch (error) {
    console.error("Error submitting quiz:", error);
    return { success: false as const, error: "Failed to submit quiz" };
  }
}
