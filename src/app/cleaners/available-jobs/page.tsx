import { requireCleaner } from "@/lib/page-guards";
import { db } from "@/db";
import { claimableJobsWhere } from "@/lib/cleaner-jobs";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { computeJobPayout, type CleanerRateInput } from "@/lib/pay-tiers";
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
      requiredCleaners: true,
      notes: true,
      employeeId: true,
      cleaners: { select: { id: true } },
    },
    orderBy: { startTime: "asc" },
    take: 100,
  });

  // Filter to only jobs that still need cleaners
  const openJobs = jobs.filter((j) => j.cleaners.length < j.requiredCleaners);

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
  const rateFor = (id: string): CleanerRateInput =>
    rateInputs.get(id) ?? { id, tier: "STANDARD", avgRating: null, ratingCount: 0 };

  const serialized = openJobs.map((j) => {
    let estPay: number | null = null;
    let estHourly: number | null = null;

    if (j.payType === "HOURLY") {
      estHourly = j.hourlyRate ?? null;
    } else if (j.payType === "PERCENTAGE" && j.price != null && j.price > 0) {
      // Simulate the roster with this cleaner added, then take their share.
      const roster = new Set<string>([cleanerId]);
      if (j.employeeId) roster.add(j.employeeId);
      for (const c of j.cleaners) roster.add(c.id);
      const payout = computeJobPayout(j.price, [...roster].map(rateFor));
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
