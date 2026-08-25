import { requireOwnerAdmin } from "@/lib/page-guards";
import { db } from "@/lib/org-db";
import {
  actionTitle,
  emailTitle,
  humanSubject,
  targetLabel,
} from "@/lib/log-labels";
import LogsClient, { type LogRow } from "./LogsClient";

export const dynamic = "force-dynamic";

// How many recent entries to load into the client for filtering/searching.
// The page filters, sorts and paginates this window in-memory; the health
// counts below are all-time and independent of this cap.
const LIMIT = 500;

export default async function LogsPage() {
  // The full system audit trail (every email, charge, and admin action) —
  // OWNER/ADMIN only. This previously used `isAdminRole`, which also admits
  // OPS_MANAGER and FIELD_LEAD.
  await requireOwnerAdmin();

  const [emails, acts, emailCounts, activityCounts] = await Promise.all([
    db.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: LIMIT }),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: LIMIT }),
    db.emailLog.groupBy({ by: ["status"], _count: true }),
    db.activityLog.groupBy({ by: ["status"], _count: true }),
  ]);

  // Resolve every referenced job to "#<number> — <client>" in one query.
  const jobIds = new Set<string>();
  for (const e of emails) if (e.jobId) jobIds.add(e.jobId);
  for (const a of acts) if (a.targetType === "job" && a.targetId) jobIds.add(a.targetId);
  const jobRows = jobIds.size
    ? await db.job.findMany({
        where: { id: { in: [...jobIds] } },
        select: { id: true, jobNumber: true, clientName: true },
      })
    : [];
  const jobMap = new Map(
    jobRows.map((j) => [j.id, { jobNumber: j.jobNumber, clientName: j.clientName }]),
  );

  const rows: LogRow[] = [];

  for (const e of emails) {
    rows.push({
      id: e.id,
      source: "email",
      createdAt: e.createdAt.toISOString(),
      category: "EMAIL",
      action: e.kind,
      kind: e.kind,
      notificationKey: e.notificationKey,
      status: e.status === "SENT" ? "SUCCESS" : e.status,
      title: emailTitle(e.kind, e.notificationKey, e.subject),
      detail: humanSubject(e.subject, e.notificationKey),
      recipient: e.recipient,
      subject: e.subject,
      actorLabel: null,
      targetType: e.jobId ? "job" : null,
      targetId: e.jobId ?? null,
      targetLabel: targetLabel(e.jobId ? "job" : null, e.jobId ?? null, jobMap),
      amount: null,
      error: e.error,
      providerId: e.providerId,
      retryable: e.status === "FAILED" && e.kind === "BOOKING_CONFIRMATION",
    });
  }

  for (const a of acts) {
    rows.push({
      id: a.id,
      source: "activity",
      createdAt: a.createdAt.toISOString(),
      category: a.category,
      action: a.action,
      kind: null,
      notificationKey: null,
      status: a.status,
      title: actionTitle(a.action),
      detail: a.message,
      recipient: null,
      subject: null,
      actorLabel: a.actorLabel ?? a.actorId,
      targetType: a.targetType ?? null,
      targetId: a.targetId ?? null,
      targetLabel: targetLabel(a.targetType ?? null, a.targetId ?? null, jobMap),
      amount: a.amount,
      error: a.error,
      providerId: a.providerId,
      retryable: false,
    });
  }

  rows.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const limited = rows.slice(0, LIMIT);

  const counts = {
    emailsSent: emailCounts.find((c) => c.status === "SENT")?._count ?? 0,
    emailsFailed: emailCounts.find((c) => c.status === "FAILED")?._count ?? 0,
    emailsPending: emailCounts.find((c) => c.status === "PENDING")?._count ?? 0,
    activityOk: activityCounts.find((c) => c.status === "SUCCESS")?._count ?? 0,
    activityFailed:
      activityCounts.find((c) => c.status === "FAILED")?._count ?? 0,
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <LogsClient rows={limited} counts={counts} />
    </div>
  );
}
