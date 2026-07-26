import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import { EMPLOYEE_ROLES } from "@/lib/metrics";
import TrainingDocsClient from "./TrainingDocsClient";

export const metadata = {
  title: "Training & Documents · Cleano",
};

/**
 * Admin Training & Documents (awer_fixes.pdf item 22).
 *
 * NOTE ON THE SPEC: the item is titled "Hide Training & Documents From Admin
 * View", but the written requirements — which the document's own preamble makes
 * the source of truth over titles and screenshots — ask for the opposite of
 * hiding it:
 *
 *   "The admin side should focus on managing training content and employee
 *    progress, not completing the training itself."
 *   "If admin needs to review it, use a clear View as Employee/Admin Preview mode."
 *
 * So the page stays, but it now defaults to a MANAGEMENT view built from real
 * TrainingModule / TrainingProgress data. The employee onboarding flow moved
 * behind an explicit preview toggle instead of being what an admin lands on.
 */
export default async function TrainingDocsPage() {
  await requireAdmin();

  const [modules, employees, documents, accessLog] = await Promise.all([
    db.trainingModule.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        duration: true,
        isRequired: true,
        isActive: true,
        videoUrl: true,
        _count: { select: { quizzes: true } },
      },
    }),
    db.user.findMany({
      where: {
        role: { in: [...EMPLOYEE_ROLES] },
        deletedAt: null,
        isActive: true,
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        trainingProgress: {
          select: {
            moduleId: true,
            status: true,
            quizScore: true,
            completedAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    // Real document library — the employee preview shows what a cleaner would
    // actually see, not invented sample PDFs.
    db.document.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, description: true, version: true, fileUrl: true },
    }),
    // Real document activity (opens, downloads, completed signatures).
    db.documentAccessLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: { select: { name: true } },
        document: { select: { title: true } },
      },
    }),
  ]);

  // Progress is measured against ACTIVE + REQUIRED modules only — an optional
  // or retired module must not make someone look permanently incomplete.
  const requiredModuleIds = new Set(
    modules.filter((m) => m.isActive && m.isRequired).map((m) => m.id)
  );

  const progressRows = employees.map((emp) => {
    const done = emp.trainingProgress.filter(
      (p) => p.status === "COMPLETED" && requiredModuleIds.has(p.moduleId)
    );
    const scores = emp.trainingProgress
      .map((p) => p.quizScore)
      .filter((s): s is number => typeof s === "number");
    const lastActivity = emp.trainingProgress
      .map((p) => p.updatedAt.getTime())
      .sort((a, b) => b - a)[0];

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      completed: done.length,
      requiredTotal: requiredModuleIds.size,
      // Null, not 0 — "no quiz taken yet" is not "scored zero".
      avgQuizScore:
        scores.length > 0
          ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
          : null,
      lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    };
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <TrainingDocsClient
        modules={modules.map((m) => ({
          id: m.id,
          title: m.title,
          description: m.description,
          duration: m.duration,
          isRequired: m.isRequired,
          isActive: m.isActive,
          hasVideo: !!m.videoUrl,
          quizCount: m._count.quizzes,
        }))}
        progress={progressRows}
        documents={documents.map((d) => ({
          id: d.id,
          title: d.title,
          description: d.description,
          version: d.version,
          hasFile: !!d.fileUrl,
        }))}
        accessLog={accessLog.map((l) => ({
          id: l.id,
          who: l.user.name ?? "Unknown",
          docTitle: l.document.title,
          action: l.action,
          at: l.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
