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

interface UpdateTrainingModuleInput {
  id: string;
  title: string;
  description?: string | null;
  videoUrl?: string | null;
  duration?: number | null;
  isRequired?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  quizzes?: QuizQuestionInput[];
}

export async function updateTrainingModule(input: UpdateTrainingModuleInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    if (!input.id || !input.title?.trim()) {
      return { success: false, error: "Module id and title are required" };
    }

    const validQuizzes = (input.quizzes || []).filter(
      (q) =>
        q.question?.trim() &&
        q.options.length >= 2 &&
        q.options.some((o) => o.isCorrect) &&
        q.options.every((o) => o.text?.trim())
    );

    await db.$transaction([
      db.trainingModule.update({
        where: { id: input.id },
        data: {
          title: input.title.trim(),
          description: input.description?.trim() || null,
          videoUrl: input.videoUrl?.trim() || null,
          duration: input.duration ?? null,
          isRequired: input.isRequired ?? false,
          isActive: input.isActive ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
      }),
      db.trainingQuiz.deleteMany({ where: { moduleId: input.id } }),
      db.trainingQuiz.createMany({
        data: validQuizzes.map((q, idx) => ({
          moduleId: input.id,
          question: q.question.trim(),
          options: q.options.map((o) => ({
            text: o.text.trim(),
            isCorrect: !!o.isCorrect,
          })),
          sortOrder: q.sortOrder ?? idx,
        })),
      }),
    ]);

    revalidatePath("/admin/settings");
    revalidatePath("/admin/training");
    revalidatePath(`/admin/training/${input.id}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating training module:", error);
    return { success: false, error: "Failed to update training module" };
  }
}
