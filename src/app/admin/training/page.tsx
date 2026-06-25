import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import TrainingClient from "./TrainingClient";

export default async function TrainingPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const userWithRole = session.user as typeof session.user & {
    role: "OWNER" | "ADMIN" | "EMPLOYEE";
  };
  const isAdmin =
    userWithRole.role === "OWNER" || userWithRole.role === "ADMIN";

  const employeeId = session.user.id;

  const totalEmployees = isAdmin
    ? await db.user.count({ where: { role: "EMPLOYEE" } })
    : 0;

  const modules = await db.trainingModule.findMany({
    where: isAdmin ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      quizzes: isAdmin
        ? { orderBy: { sortOrder: "asc" } }
        : { select: { id: true } },
      progress: isAdmin
        ? {
            include: {
              employee: { select: { id: true, name: true } },
            },
          }
        : {
            where: { employeeId },
            take: 1,
          },
    },
  });

  const moduleData = modules.map((m) => {
    const myProgress = isAdmin
      ? m.progress.find((p) => p.employeeId === employeeId)
      : m.progress[0];
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      videoUrl: m.videoUrl,
      duration: m.duration,
      isRequired: m.isRequired,
      isActive: m.isActive,
      hasQuiz: m.quizzes.length > 0,
      progress: myProgress
        ? {
            status: myProgress.status,
            videoProgress: myProgress.videoProgress,
            quizScore: myProgress.quizScore,
            quizAttempts: myProgress.quizAttempts,
            completedAt: myProgress.completedAt?.toISOString() || null,
          }
        : null,
    };
  });

  const adminModules = isAdmin
    ? modules.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        videoUrl: m.videoUrl,
        duration: m.duration,
        isRequired: m.isRequired,
        isActive: m.isActive,
        sortOrder: m.sortOrder,
        quizzes: (
          m.quizzes as Array<{
            id: string;
            question: string;
            options: unknown;
            sortOrder: number;
          }>
        ).map((q) => ({
          id: q.id,
          question: q.question,
          options: (q.options as { text: string; isCorrect: boolean }[]) || [],
          sortOrder: q.sortOrder,
        })),
        progress: (
          m.progress as Array<{
            id: string;
            employeeId: string;
            status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
            videoProgress: number;
            quizScore: number | null;
            employee: { id: string; name: string };
          }>
        ).map((p) => ({
          id: p.id,
          employeeId: p.employeeId,
          status: p.status,
          videoProgress: p.videoProgress,
          quizScore: p.quizScore,
          employee: p.employee,
        })),
      }))
    : null;

  return (
    <div className="cl-page-wrap">
      <TrainingClient
        isAdmin={isAdmin}
        modules={moduleData}
        adminModules={adminModules}
        totalEmployees={totalEmployees}
      />
    </div>
  );
}
