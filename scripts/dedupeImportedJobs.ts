/**
 * Cleanup for duplicate jobs created by earlier BookingKoala imports (spec
 * item 5). Import-time dedup now keys on `externalBookingId`, so NEW
 * duplicates can't happen — this sweeps up the ones already in the DB.
 *
 * Two passes:
 *  1. AUTO: live jobs sharing the same externalBookingId — keeps the best row
 *     (paid > has assignment/logs > oldest) and soft-deletes the rest.
 *  2. REPORT-ONLY: live jobs for the same client at the same start time where
 *     the rows don't share a booking id (e.g. one import tagged, one manual).
 *     These can be legitimate concurrent bookings, so they are listed for
 *     manual review and never auto-deleted.
 *
 *   npx tsx scripts/dedupeImportedJobs.ts            # dry-run (default)
 *   npx tsx scripts/dedupeImportedJobs.ts --commit   # apply pass 1
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

type JobRow = {
  id: string;
  jobNumber: number;
  clientName: string;
  startTime: Date;
  status: string;
  paymentReceived: boolean;
  externalBookingId: string | null;
  createdAt: Date;
  _count: { cleaners: number; logs: number; photos: number; invoices: number };
};

// Start hour in the business timezone — used to spot UTC-shifted imports
// (the PDF's "same Sep 4 job at 9:00 AM active vs 5:00 AM archived" case).
function torontoHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Toronto",
      hour: "numeric",
      hour12: false,
    }).format(d)
  );
}

// Higher score = more worth keeping.
function keepScore(j: JobRow): number {
  let score = 0;
  if (j.paymentReceived || j.status === "PAID") score += 1000;
  if (j.status === "COMPLETED") score += 500;
  // A copy starting inside business hours beats a 4-6 AM UTC-shifted twin.
  const h = torontoHour(j.startTime);
  if (h >= 7 && h <= 21) score += 200;
  score += j._count.cleaners * 50;
  score += j._count.invoices * 50;
  score += j._count.photos * 20;
  score += j._count.logs;
  // Older row wins ties (it's the one other records reference).
  score -= j.createdAt.getTime() / 1e12;
  return score;
}

async function main() {
  const jobs = (await db.job.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      startTime: true,
      status: true,
      paymentReceived: true,
      externalBookingId: true,
      createdAt: true,
      _count: {
        select: { cleaners: true, logs: true, photos: true, invoices: true },
      },
    },
  })) as JobRow[];

  // ── Pass 1: exact externalBookingId duplicates ────────────────────────────
  const byBookingId = new Map<string, JobRow[]>();
  for (const j of jobs) {
    if (!j.externalBookingId) continue;
    const list = byBookingId.get(j.externalBookingId) ?? [];
    list.push(j);
    byBookingId.set(j.externalBookingId, list);
  }

  const toDelete: JobRow[] = [];
  for (const [bookingId, group] of byBookingId) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => keepScore(b) - keepScore(a));
    const keep = sorted[0];
    const drop = sorted.slice(1);
    console.log(
      `Booking ${bookingId}: ${group.length} copies — keeping #${keep.jobNumber} (${keep.status}), archiving ${drop
        .map((d) => `#${d.jobNumber}`)
        .join(", ")}`
    );
    toDelete.push(...drop);
  }

  // ── Pass 2: same client + same start time, different/absent booking ids ──
  const byClientTime = new Map<string, JobRow[]>();
  for (const j of jobs) {
    if (toDelete.some((d) => d.id === j.id)) continue;
    const key = `${j.clientName.trim().toLowerCase()}|${j.startTime.toISOString()}`;
    const list = byClientTime.get(key) ?? [];
    list.push(j);
    byClientTime.set(key, list);
  }
  const reviewGroups = [...byClientTime.values()].filter((g) => {
    if (g.length < 2) return false;
    const ids = new Set(g.map((j) => j.externalBookingId).filter(Boolean));
    // All sharing one booking id was already handled in pass 1.
    return ids.size !== 1 || g.some((j) => !j.externalBookingId);
  });

  console.log(`\nAuto-archivable exact duplicates: ${toDelete.length}`);
  console.log(`Same-client same-time groups for MANUAL review: ${reviewGroups.length}`);
  for (const g of reviewGroups) {
    console.log(
      `  · ${g[0].clientName} @ ${g[0].startTime.toISOString()}: ${g
        .map((j) => `#${j.jobNumber} (${j.status}${j.externalBookingId ? `, bk:${j.externalBookingId}` : ", no booking id"})`)
        .join(" | ")}`
    );
  }

  if (!commit) {
    console.log("\nDry-run only. Re-run with --commit to archive the exact duplicates.");
    return;
  }
  if (toDelete.length === 0) {
    console.log("\nNothing to archive.");
    return;
  }

  const res = await db.job.updateMany({
    where: { id: { in: toDelete.map((j) => j.id) } },
    data: { deletedAt: new Date() },
  });
  console.log(`\nArchived ${res.count} duplicate job(s) (soft-delete — recoverable from the Archived view).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
