import { requireCleaner } from "@/lib/page-guards";
import { db } from "@/db";
import AvailableJobsClient from "./AvailableJobsClient";

export default async function AvailableJobsPage() {
  const session = await requireCleaner();

  const now = new Date();

  // Jobs that: are upcoming, not cancelled, not fully staffed, and the cleaner hasn't already claimed
  const jobs = await db.job.findMany({
    where: {
      startTime: { gte: now },
      status: { notIn: ["CANCELLED", "COMPLETED"] },
      cleaners: { none: { id: session.user.id } },
    },
    include: {
      cleaners: { select: { id: true } },
    },
    orderBy: { startTime: "asc" },
    take: 100,
  });

  // Filter to only jobs that still need cleaners
  const openJobs = jobs.filter((j) => j.cleaners.length < j.requiredCleaners);

  const serialized = openJobs.map((j) => ({
    id: j.id,
    jobNumber: j.jobNumber,
    clientName: j.clientName,
    startTime: j.startTime.toISOString(),
    isFlexible: j.isFlexible,
    location: j.location,
    jobType: j.jobType,
    price: j.price,
    bedCount: j.bedCount,
    bathCount: j.bathCount,
    requiredCleaners: j.requiredCleaners,
    claimedCount: j.cleaners.length,
    notes: j.notes,
  }));

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
