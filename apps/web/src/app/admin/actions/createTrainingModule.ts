"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface QuizOptionInput {
  text: string;
  isCorrect: boolean;
}

interface QuizQuestionInput {
  question: string;
  options: QuizOptionInput[];
  sortOrder?: number;
}

interface CreateTrainingModuleInput {
  title: string;
  description?: string | null;
  videoUrl?: string | null;
  duration?: number | null;
  isRequired?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  quizzes?: QuizQuestionInput[];
}

export async function createTrainingModule(input: CreateTrainingModuleInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    if (!input.title?.trim()) {
      return { success: false, error: "Title is required" };
    }

    const validQuizzes = (input.quizzes || []).filter(
      (q) =>
        q.question?.trim() &&
        q.options.length >= 2 &&
        q.options.some((o) => o.isCorrect) &&
        q.options.every((o) => o.text?.trim())
    );

    const moduleRow = await db.trainingModule.create({
      data: {
        title: input.title.trim(),
        description: input.description?.trim() || null,
        videoUrl: input.videoUrl?.trim() || null,
        duration: input.duration ?? null,
        isRequired: input.isRequired ?? false,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        quizzes: {
          create: validQuizzes.map((q, idx) => ({
            question: q.question.trim(),
            options: q.options.map((o) => ({
              text: o.text.trim(),
              isCorrect: !!o.isCorrect,
            })),
            sortOrder: q.sortOrder ?? idx,
          })),
        },
      },
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/training");
    return { success: true, moduleId: moduleRow.id };
  } catch (error) {
    console.error("Error creating training module:", error);
    return { success: false, error: "Failed to create training module" };
  }
}
