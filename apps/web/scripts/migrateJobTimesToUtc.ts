/**
 * One-shot timezone normalization for jobs created BEFORE the wall-clock fix.
 *
 * Background: the old admin/CSV job-create code stored a typed time like
 * "1:00 PM" as `13:00Z` (the wall-clock digits parked in UTC). The fixed code
 * (commit b9b1f2f, `tzWallClockToUtc`) stores the TRUE instant — 1 PM Toronto =
 * `17:00Z` in summer. Every display now formats in America/Toronto, which is
 * correct for the new (true-UTC) jobs but shows the OLD jobs 4-5h early.
 *
 * This converts each pre-fix job's startTime/endTime/jobDate: it reads the
 * stored UTC wall-clock (13:00) and re-interprets it AS America/Toronto,
 * producing the true instant (17:00Z). Idempotency is guarded by a createdAt
 * cutoff — only jobs created before the fix deployed are touched, so new
 * true-UTC jobs are never double-shifted.
 *
 *   npx tsx scripts/migrateJobTimesToUtc.ts --before=2026-07-21T00:00:00Z            # dry-run
 *   npx tsx scripts/migrateJobTimesToUtc.ts --before=2026-07-21T00:00:00Z --commit   # apply
 *
 * Pass --before = the moment the storage fix went live (jobs created at/after
 * it are already true-UTC and are skipped). --all overrides the cutoff (use
 * only if you're certain no true-UTC jobs exist yet). Archived jobs are left
 * untouched.
 */
import { PrismaClient } from "@prisma/client";
import { refuseOnMultiTenant } from "./_scope";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");
const all = process.argv.includes("--all");
const beforeArg = process.argv.find((a) => a.startsWith("--before="))?.split("=")[1];
const before = beforeArg ? new Date(beforeArg) : null;

// UTC instant for a wall-clock date/time interpreted in America/Toronto.
// (Standalone copy of src/lib/time.ts tzWallClockToUtc to avoid path aliases.)
const TZ = "America/Toronto";
function tzOffsetMs(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wallAsUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return wallAsUtc - (d.getTime() - d.getMilliseconds());
}
// Read the stored value's UTC wall-clock components, re-interpret as Toronto.
function wallClockUtcToTrueInstant(stored: Date): Date {
  const wallAsUtc = Date.UTC(
    stored.getUTCFullYear(), stored.getUTCMonth(), stored.getUTCDate(),
    stored.getUTCHours(), stored.getUTCMinutes(), stored.getUTCSeconds()
  );
  let offset = tzOffsetMs(new Date(wallAsUtc));
  const refined = tzOffsetMs(new Date(wallAsUtc - offset));
  if (refined !== offset) offset = refined;
  return new Date(wallAsUtc - offset);
}
const hhmm = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

async function main() {
  // Written when there was one company; its queries do not name one.
  await refuseOnMultiTenant(db, "migrateJobTimesToUtc.ts");

  if (!before && !all) {
    console.error("Refusing to run without a scope. Pass --before=<ISO of the storage-fix deploy> (recommended) or --all.");
    process.exitCode = 1;
    return;
  }

  const where: Record<string, unknown> = { deletedAt: null };
  if (before) where.createdAt = { lt: before };

  const jobs = await db.job.findMany({
    where,
    select: { id: true, jobNumber: true, clientName: true, startTime: true, endTime: true, jobDate: true, createdAt: true },
    orderBy: { startTime: "asc" },
  });

  console.log(`Candidates (active${before ? `, created before ${before.toISOString()}` : ", ALL"}): ${jobs.length}`);
  console.log("Sample conversions (Toronto wall-clock shown):");
  for (const j of jobs.slice(0, 8)) {
    const ns = wallClockUtcToTrueInstant(j.startTime);
    console.log(`  #${j.jobNumber} ${j.clientName}: ${hhmm(j.startTime)} (as-is, wrong) -> ${hhmm(ns)} (fixed)`);
  }

  if (!commit) {
    console.log(`\nDry-run only. Re-run with --commit to convert ${jobs.length} job(s).`);
    return;
  }

  let n = 0;
  for (const j of jobs) {
    await db.job.update({
      where: { id: j.id },
      data: {
        startTime: wallClockUtcToTrueInstant(j.startTime),
        endTime: j.endTime ? wallClockUtcToTrueInstant(j.endTime) : null,
        jobDate: j.jobDate ? wallClockUtcToTrueInstant(j.jobDate) : null,
      },
    });
    n++;
  }
  console.log(`\nConverted ${n} job(s) to true-UTC instants.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
