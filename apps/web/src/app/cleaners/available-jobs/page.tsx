import { requireCleaner } from "@/lib/page-guards";
import { db } from "@/lib/org-db";
import { claimableJobsWhere } from "@/lib/cleaner-jobs";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { deriveArea } from "@/server/jobs/area";
import { allowedCategoriesOf, estimateFor, isOpenForCaller } from "@/server/available/board";
import AvailableJobsClient from "./AvailableJobsClient";

export default async function AvailableJobsPage() {
  const session = await requireCleaner();
  const cleanerId = session.user.id;

  const now = new Date();

  // Which service categories this cleaner is approved for (awerfixes.pdf item
  // 3). An empty list means no restriction — see @/lib/service-permissions.
  const allowedCategories = await allowedCategoriesOf(cleanerId);

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
  // alias map in normalizeJobType to decide. The same predicate the phone's
  // board and the claim use (server/available/board.ts).
  const openJobs = jobs.filter((j) => isOpenForCaller(j, allowedCategories));

  // Estimated payout for THIS cleaner if they claimed the job. Computed
  // server-side from the real tier/split math — the card used to print
  // `price / 2`, which both leaked half the client price and wasn't the
  // cleaner's actual pay. `price` never leaves the server. Each cleaner earns
  // their own rate on the full price, so the estimate doesn't depend on who
  // else is on the job; the rating multiplier rides inside the rate
  // (awerfixes.pdf item 1). FLAT: dispatch sets the payout per assignment, so
  // there's no honest estimate. Shared with the phone (estimateFor).
  const rateInputs = await getCleanerRateInputs([cleanerId]);
  const myRate = rateInputs.get(cleanerId);

  const serialized = openJobs.map((j) => {
    const { estPay, estHourly } = estimateFor(j, cleanerId, myRate);

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
