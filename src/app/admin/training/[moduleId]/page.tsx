import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/org-db";
import ModuleView from "./ModuleView";

export default async function TrainingModulePage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}) {
  const { moduleId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const employeeId = session.user.id;

  const moduleRow = await db.trainingModule.findUnique({
    where: { id: moduleId },
    include: {
      quizzes: { orderBy: { sortOrder: "asc" } },
      progress: { where: { employeeId }, take: 1 },
    },
  });

  if (!moduleRow || !moduleRow.isActive) {
    notFound();
  }

  const progress = moduleRow.progress[0];

  const quizzes = moduleRow.quizzes.map((q) => {
    const opts = (q.options as unknown as { text: string; isCorrect: boolean }[]) || [];
    return {
      id: q.id,
      question: q.question,
      options: opts.map((o) => ({ text: o.text })),
    };
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <ModuleView
        module={{
          id: moduleRow.id,
          title: moduleRow.title,
          description: moduleRow.description,
          videoUrl: moduleRow.videoUrl,
          duration: moduleRow.duration,
          isRequired: moduleRow.isRequired,
        }}
        quizzes={quizzes}
        initialProgress={
          progress
            ? {
                status: progress.status,
                videoProgress: progress.videoProgress,
                quizScore: progress.quizScore,
                quizAttempts: progress.quizAttempts,
              }
            : null
        }
      />
    </div>
  );
}
