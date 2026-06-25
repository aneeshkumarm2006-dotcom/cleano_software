// Shared badge computation for the calendar data actions (getJobsForCalendar /
// getJobsForDay). Produces, per job:
//   - priorityLabel: the resolved "R"/"I"/none label (override > admin mapping)
//   - missingEquipment: equipment the assigned cleaner(s) lack for the job
//
// Missing equipment drives the top-left "error" badge. For cleaners we check the
// viewer's own inventory (legacy behaviour); for admins/owners we check every
// cleaner assigned to each job so the operations manager sees the warning too.

import { db } from "@/db";
import { getSetting } from "@/lib/settings";
import { resolvePriorityLabel, type PriorityLabel } from "@/lib/calendar-labels";

export type MissingItem = { productName: string; needed: number; have: number };

interface JobForBadge {
  id: string;
  jobType: string | null;
  priorityLabel: string | null;
  status: string;
  employeeId: string | null;
  cleaners: { id: string; name: string }[];
}

const DONE_STATUSES = new Set(["COMPLETED", "PAID", "CANCELLED"]);

export async function computeBadgeMaps(
  jobs: JobForBadge[],
  opts: { isAdmin: boolean; viewerId: string }
): Promise<{
  priority: Record<string, PriorityLabel>;
  missing: Record<string, MissingItem[]>;
}> {
  // ── Priority labels (override > admin-configured mapping) ──────────────────
  const config = await getSetting("calendar.jobTypeLabels");
  const priority: Record<string, PriorityLabel> = {};
  for (const job of jobs) {
    priority[job.id] = resolvePriorityLabel(job.jobType, job.priorityLabel, config);
  }

  // ── Missing equipment ─────────────────────────────────────────────────────
  const missing: Record<string, MissingItem[]> = {};
  if (jobs.length === 0) return { priority, missing };

  const rules = await db.inventoryRule.findMany({ include: { product: true } });
  const activeRules = rules.filter((r) => r.usagePerJob > 0);
  if (activeRules.length === 0) return { priority, missing };

  // Which cleaner(s)' inventory matters for each job.
  const cleanerIdsFor = (job: JobForBadge): string[] =>
    opts.isAdmin
      ? [
          ...job.cleaners.map((c) => c.id),
          ...(job.employeeId ? [job.employeeId] : []),
        ]
      : [opts.viewerId];

  const needed = new Set<string>();
  for (const job of jobs) {
    if (DONE_STATUSES.has(job.status)) continue;
    for (const id of cleanerIdsFor(job)) needed.add(id);
  }
  if (needed.size === 0) return { priority, missing };

  const eps = await db.employeeProduct.findMany({
    where: { employeeId: { in: [...needed] } },
  });
  // employeeId -> productId -> quantity
  const inv: Record<string, Record<string, number>> = {};
  for (const ep of eps) {
    (inv[ep.employeeId] ||= {})[ep.productId] = ep.quantity;
  }

  for (const job of jobs) {
    if (DONE_STATUSES.has(job.status)) continue;
    const ids = cleanerIdsFor(job);
    if (ids.length === 0) continue;
    const items: MissingItem[] = [];
    for (const rule of activeRules) {
      // Flag the product if ANY assigned cleaner is short of the per-job need.
      const haves = ids.map((id) => inv[id]?.[rule.productId] ?? 0);
      const minHave = Math.min(...haves);
      if (minHave < rule.usagePerJob) {
        items.push({
          productName: rule.product.name,
          needed: rule.usagePerJob,
          have: minHave,
        });
      }
    }
    if (items.length > 0) missing[job.id] = items;
  }

  return { priority, missing };
}
