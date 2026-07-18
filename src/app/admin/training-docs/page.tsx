import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import TrainingDocsClient from "./TrainingDocsClient";

export const metadata = {
  title: "Training & Documents · Cleano",
};

export default async function TrainingDocsPage() {
  await requireAdmin();

  // Item 20: the access log shows REAL document activity (opens, downloads,
  // completions recorded by the signing flow) — not sample data.
  const accessLog = await db.documentAccessLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true } },
      document: { select: { title: true } },
    },
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <TrainingDocsClient
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
