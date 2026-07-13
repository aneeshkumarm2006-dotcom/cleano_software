/**
 * One-shot recovery: on 2026-07-11 a single bulk action soft-deleted 778 jobs
 * (all 353 BookingKoala imports + every COMPLETED/PAID job), which is why the
 * Jobs page looked empty and Total Revenue read $0.00.
 *
 * Soft delete only sets `deletedAt`, so this restores them by clearing it.
 * Scoped to ONE archive timestamp so it can't resurrect jobs that were
 * legitimately deleted at some other time.
 *
 *   npx tsx scripts/restoreArchivedJobs.ts            # dry-run (default)
 *   npx tsx scripts/restoreArchivedJobs.ts --commit   # apply
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

// The mass-archive event. Only jobs deleted inside this window are restored.
const INCIDENT_FROM = new Date("2026-07-11T18:30:00.000Z");
const INCIDENT_TO = new Date("2026-07-11T18:45:00.000Z");

async function main() {
  const where = {
    deletedAt: { gte: INCIDENT_FROM, lte: INCIDENT_TO },
  };

  const jobs = await db.job.findMany({
    where,
    select: {
      id: true,
      status: true,
      price: true,
      bookingSource: true,
      paymentReceived: true,
    },
  });

  const imported = jobs.filter((j) => j.bookingSource).length;
  const revenueJobs = jobs.filter(
    (j) => j.paymentReceived && ["COMPLETED", "PAID"].includes(j.status)
  );
  const revenue = revenueJobs.reduce((s, j) => s + (j.price ?? 0), 0);

  console.log(`Archived in the incident window: ${jobs.length} job(s)`);
  console.log(`  · imported (BookingKoala): ${imported}`);
  console.log(
    `  · completed+paid (revenue-bearing): ${revenueJobs.length} → ~$${revenue.toFixed(2)}`
  );

  // Sanity: anything soft-deleted OUTSIDE the window stays archived.
  const otherArchived = await db.job.count({
    where: { deletedAt: { not: null }, NOT: where },
  });
  console.log(`Left archived (deleted at another time, untouched): ${otherArchived}`);

  if (!commit) {
    console.log("\nDry-run only — rerun with --commit to restore.");
    return;
  }

  const res = await db.job.updateMany({ where, data: { deletedAt: null } });
  console.log(`\nRestored ${res.count} job(s) to the active Jobs list.`);

  const activeNow = await db.job.count({ where: { deletedAt: null } });
  console.log(`Active jobs now: ${activeNow}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
