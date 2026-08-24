import { requireCleaner } from "@/lib/page-guards";
import { db } from "@/lib/org-db";
import { claimableJobsWhere } from "@/lib/cleaner-jobs";
import { isCategoryAllowed } from "@/lib/service-permissions";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import {
  computeJobPayout,
  fallbackRateInput,
  type CleanerRateInput,
} from "@/lib/pay-tiers";
import AvailableJobsClient from "./AvailableJobsClient";

/**
 * Coarse area for the filter dropdown, derived from the job address
 * ("123 Rue Sainte-Catherine, Montreal, QC H2X 1Y4" → "Montreal"). Purely a
 * scanning aid — an unparseable address just has no area.
 */
function deriveArea(location: string | null): string | null {
  if (!location) return null;
  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const area = parts[1].replace(/\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d$/i, "").trim();
  return area || null;
}

export default async function AvailableJobsPage() {
  const session = await requireCleaner();
  const cleanerId = session.user.id;

  const now = new Date();

  // Which service categories this cleaner is approved for (awerfixes.pdf item
  // 3). An empty list means no restriction — see @/lib/service-permissions.
  const me = await db.user.findUnique({
    where: { id: cleanerId },
    select: { allowedServiceCategories: true },
  });
  const allowedCategories = me?.allowedServiceCategories ?? [];

  // Genuinely open, claimable jobs only (see @/lib/cleaner-jobs): not deleted,
  // still ahead of us, CREATED/SCHEDULED only (IN_PROGRESS / PAID jobs are not
  // "available"), and not a job this cleaner already leads or is already on.
  const jobs = await db.job.findMany({
    where: claimableJobsWhere(cleanerId, now),
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      startTime: true,
      endTime: true,
      isFlexible: true,
      location: true,
      jobType: true,
      price: true,
      payType: true,
      hourlyRate: true,
      bedCount: true,
      bathCount: true,
      propertyType: true,
      requiredCleaners: true,
      notes: true,
      employeeId: true,
      cleaners: { select: { id: true } },
    },
    orderBy: { startTime: "asc" },
    // Two filters run in JS below (capacity, which is a relation count the
    // where-clause can't express, and service category, which needs the alias
    // map because jobType is free text). Both narrow the page AFTER the fetch,
    // so a tight limit here becomes a silently short board — a cleaner
    // restricted to RESIDENTIAL could have all 100 rows eaten by commercial
    // work. 300 covers the live job table several times over.
    take: 300,
  });

  // Filter to jobs that still need cleaners AND that this cleaner is approved
  // to work. Category gating cannot live in the Prisma where-clause: jobType is
  // free text ("House", "Move In & Out", "R - Residential"), so it takes the
  // alias map in normalizeJobType to decide.
  const openJobs = jobs.filter(
    (j) =>
      j.cleaners.length < j.requiredCleaners &&
      isCategoryAllowed(j.jobType, allowedCategories)
  );

  // Estimated payout for THIS cleaner if they claimed the job. Computed
  // server-side from the real tier/split math — the card used to print
  // `price / 2`, which both leaked half the client price and wasn't the
  // cleaner's actual pay. `price` never leaves the server.
  const participantIds = new Set<string>([cleanerId]);
  for (const j of openJobs) {
    if (j.employeeId) participantIds.add(j.employeeId);
    for (const c of j.cleaners) participantIds.add(c.id);
  }
  const rateInputs = await getCleanerRateInputs([...participantIds]);
  // The multiplier rides inside CleanerRateInput, so the estimate below picks up
  // the cleaner's rating premium automatically (awerfixes.pdf item 1).
  const rateFor = (id: string): CleanerRateInput =>
    rateInputs.get(id) ?? fallbackRateInput(id);

  const serialized = openJobs.map((j) => {
    let estPay: number | null = null;
    let estHourly: number | null = null;

    if (j.payType === "HOURLY") {
      estHourly = j.hourlyRate ?? null;
    } else if (j.payType === "PERCENTAGE" && j.price != null && j.price > 0) {
      // Each cleaner earns their own rate on the full price, so the estimate no
      // longer depends on who else is on the job — no roster simulation, and no
      // way for a stale employeeId to skew the number (awer_fixes.pdf item 3).
      const payout = computeJobPayout(j.price, [rateFor(cleanerId)]);
      estPay = payout.shares.find((s) => s.id === cleanerId)?.amount ?? null;
    }
    // FLAT: the payout is set by dispatch per assignment — no honest estimate
    // to show here, so the card says so rather than inventing a number.

    return {
      id: j.id,
      jobNumber: j.jobNumber,
      clientName: j.clientName,
      startTime: j.startTime.toISOString(),
      isFlexible: j.isFlexible,
      location: j.location,
      area: deriveArea(j.location),
      jobType: j.jobType,
      payType: j.payType as string,
      estPay,
      estHourly,
      bedCount: j.bedCount,
      bathCount: j.bathCount,
      propertyType: j.propertyType,
      requiredCleaners: j.requiredCleaners,
      claimedCount: j.cleaners.length,
      notes: j.notes,
    };
  });

  return (
    <div className="cl-page-wrap">
      <div className="cl-page-head">
        <div>
          <h1 className="cl-page-title">
            <span className="cl-page-title-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
            </span>
            Available jobs
          </h1>
          <p className="cl-page-sub">Open shifts you can claim. Jobs disappear once they&apos;re fully staffed.</p>
        </div>
      </div>

      <AvailableJobsClient jobs={serialized} />
    </div>
  );
}
