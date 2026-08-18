// Shared badge computation for the calendar data actions (getJobsForCalendar /
// getJobsForDay). Produces, per job:
//   - priorityLabel: the resolved "R"/"I"/none label (override > admin mapping)
//   - missingEquipment: equipment the assigned cleaner(s) lack for the job
//
// Missing equipment drives the top-left "error" badge. For cleaners we check the
// viewer's own inventory (legacy behaviour); for admins/owners we check every
// cleaner assigned to each job so the operations manager sees the warning too.
//
// The option that picks between those two was called `isAdmin`, which had grown
// into a three-way overload (job scope / kit scope / money visibility) by the
// time Stage 7 gave FIELD_LEAD a group calendar. A field lead needs the
// crew-wide kit warning and must NOT see money, so the flag is named for what it
// actually decides. Money visibility is a separate flag on the resolved viewer —
// see `./_calendarScope.ts`.

import { db } from "@/db";
import { loadPerJobAverages } from "@/lib/inventory-forecast.server";
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
  opts: {
    /**
     * Check EVERY cleaner assigned to each job (true) or only the viewer's own
     * kit (false). The caller has already scoped `jobs` to what the viewer may
     * see, so true never widens visibility beyond that set.
     */
    allAssignedCleaners: boolean;
    viewerId: string;
  }
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

  // What a job actually consumes, measured from reported usage rather than the
  // retired InventoryRule.usagePerJob (awerfixes.pdf item 14). Products with no
  // usage history simply aren't checked — the badge only ever claimed to catch
  // shortfalls it could quantify, and inventing a need for an unmeasured
  // product would put a warning on every job on the calendar.
  const avgPerJob = await loadPerJobAverages();
  if (avgPerJob.size === 0) return { priority, missing };
  const products = await db.product.findMany({
    where: { id: { in: [...avgPerJob.keys()] } },
    select: { id: true, name: true },
  });
  const activeNeeds = products
    .map((p) => ({
      productId: p.id,
      productName: p.name,
      needed: avgPerJob.get(p.id) ?? 0,
    }))
    .filter((n) => n.needed > 0);
  if (activeNeeds.length === 0) return { priority, missing };

  // Which cleaner(s)' inventory matters for each job.
  const cleanerIdsFor = (job: JobForBadge): string[] =>
    opts.allAssignedCleaners
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
    for (const need of activeNeeds) {
      // Flag the product if ANY assigned cleaner is short of the per-job need.
      const haves = ids.map((id) => inv[id]?.[need.productId] ?? 0);
      const minHave = Math.min(...haves);
      if (minHave < need.needed) {
        items.push({
          productName: need.productName,
          needed: Math.round(need.needed * 100) / 100,
          have: minHave,
        });
      }
    }
    if (items.length > 0) missing[job.id] = items;
  }

  return { priority, missing };
}
