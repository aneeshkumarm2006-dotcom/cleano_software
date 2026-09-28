/**
 * Backfill JobWorkSession rows from the legacy clock pairs
 * (awerfixes.pdf item 6, round 3).
 *
 * BACKGROUND
 * Work used to be one clockInTime/clockOutTime pair per JobAssignment, plus an
 * older pair on the Job itself for rows created before per-cleaner assignments
 * existed. Since item 6 the record of work is JobWorkSession rows, and those
 * two pairs are DERIVED mirrors of them.
 *
 * WHAT IT DOES
 * One session per existing pair:
 *   1. every JobAssignment with a clockInTime → a session for that cleaner
 *      (endedAt = its clockOutTime, or NULL if the shift was never closed);
 *   2. jobs with a job-level clockInTime and NO such assignment → one session
 *      keyed to `employeeId`, or the single assigned cleaner if there is
 *      exactly one and no employeeId.
 *
 * THIS IS NOT REQUIRED FOR CORRECTNESS. `sessionsFromLegacyPair` in
 * src/lib/work-sessions.ts reads an un-backfilled pair as the one session it
 * represents, so hours, payroll and every screen are already right without it.
 * Running it just moves that history into the table so the session log shows it
 * directly instead of via the fallback.
 *
 * IDEMPOTENT: a job that already has ANY session row is skipped entirely, so a
 * re-run cannot duplicate work. Jobs with no clock-in at all are skipped.
 *
 *   npx tsx scripts/backfillJobWorkSessions.ts            # dry run (default)
 *   npx tsx scripts/backfillJobWorkSessions.ts --commit   # actually write
 */
import { PrismaClient } from "@prisma/client";
import { refuseOnMultiTenant } from "./_scope";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

interface PlannedSession {
  jobId: string;
  jobNumber: number;
  cleanerId: string;
  startedAt: Date;
  endedAt: Date | null;
  source: "assignment" | "job-level";
}

async function main() {
  // Written when there was one company; its queries do not name one.
  await refuseOnMultiTenant(db, "backfillJobWorkSessions.ts");

  console.log(
    `Backfill JobWorkSession — ${commit ? "COMMIT" : "DRY RUN (no writes)"}\n`
  );

  // House rule: `prisma migrate deploy` runs BEFORE the code deploy, so this
  // script is normally run against a database that already has the table. Say
  // so plainly rather than throwing a P2021 stack trace at whoever runs it too
  // early — the state is expected, not broken.
  const [{ exists }] = await db.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'JobWorkSession'
    ) AS "exists"
  `;
  if (!exists) {
    console.log(
      "  The JobWorkSession table does not exist in this database yet.\n" +
        "  Apply prisma/migrations/20260807020000_job_work_sessions first:\n" +
        "      npx prisma migrate deploy\n" +
        "  Nothing was read or written."
    );
    return;
  }

  const jobs = await db.job.findMany({
    where: {
      OR: [
        { clockInTime: { not: null } },
        { assignments: { some: { clockInTime: { not: null } } } },
      ],
    },
    select: {
      id: true,
      jobNumber: true,
      employeeId: true,
      clockInTime: true,
      clockOutTime: true,
      cleaners: { select: { id: true } },
      assignments: {
        select: { cleanerId: true, clockInTime: true, clockOutTime: true },
      },
      workSessions: { select: { id: true }, take: 1 },
    },
    orderBy: { startTime: "asc" },
  });

  const planned: PlannedSession[] = [];
  let alreadyDone = 0;
  let unattributable = 0;
  const unattributableJobs: number[] = [];

  for (const job of jobs) {
    // Idempotency: never add to a job that already has sessions.
    if (job.workSessions.length > 0) {
      alreadyDone++;
      continue;
    }

    const withClock = job.assignments.filter((a) => a.clockInTime !== null);

    if (withClock.length > 0) {
      for (const a of withClock) {
        planned.push({
          jobId: job.id,
          jobNumber: job.jobNumber,
          cleanerId: a.cleanerId,
          startedAt: a.clockInTime!,
          endedAt: a.clockOutTime,
          source: "assignment",
        });
      }
      continue;
    }

    if (!job.clockInTime) continue;

    // Job-level pair with no per-cleaner row. Attribute it to the lead, or to
    // the only cleaner if there is exactly one and no lead. Anything more
    // ambiguous is left alone: inventing whose hours these were would put a
    // guess into payroll, and the legacy fallback already reads them correctly.
    const owner =
      job.employeeId ??
      (job.cleaners.length === 1 ? job.cleaners[0].id : null);
    if (!owner) {
      unattributable++;
      unattributableJobs.push(job.jobNumber);
      continue;
    }

    planned.push({
      jobId: job.id,
      jobNumber: job.jobNumber,
      cleanerId: owner,
      startedAt: job.clockInTime,
      endedAt: job.clockOutTime,
      source: "job-level",
    });
  }

  const open = planned.filter((p) => p.endedAt === null).length;
  const fromAssignments = planned.filter((p) => p.source === "assignment").length;
  const fromJobLevel = planned.filter((p) => p.source === "job-level").length;
  const touchedJobs = new Set(planned.map((p) => p.jobId)).size;

  console.log(`  jobs with any clock history ......... ${jobs.length}`);
  console.log(`  ...already have sessions (skipped) .. ${alreadyDone}`);
  console.log(`  sessions to create .................. ${planned.length}`);
  console.log(`    from JobAssignment pairs .......... ${fromAssignments}`);
  console.log(`    from job-level pairs .............. ${fromJobLevel}`);
  console.log(`  ...of which still OPEN (no end) ..... ${open}`);
  console.log(`  jobs affected ....................... ${touchedJobs}`);
  if (unattributable > 0) {
    console.log(
      `  ⚠️  job-level pairs with no identifiable cleaner: ${unattributable}` +
        `\n      (jobs ${unattributableJobs.slice(0, 10).join(", ")}${unattributableJobs.length > 10 ? ", …" : ""})` +
        `\n      Left alone on purpose — the legacy fallback still reads them.`
    );
  }

  if (planned.length > 0) {
    console.log("\n  sample (first 8):");
    for (const p of planned.slice(0, 8)) {
      console.log(
        `    job #${String(p.jobNumber).padStart(5)}  ${p.startedAt.toISOString()} → ` +
          `${p.endedAt ? p.endedAt.toISOString() : "OPEN"}  (${p.source})`
      );
    }
  }

  if (!commit) {
    console.log(
      `\nDry run only. Re-run with --commit to create ${planned.length} session(s).` +
        `\nNothing depends on this: work-sessions.ts falls back to the legacy pair,` +
        `\nso hours and payroll are already correct either way.`
    );
    return;
  }

  let created = 0;
  for (const p of planned) {
    try {
      await db.jobWorkSession.create({
        data: {
          jobId: p.jobId,
          cleanerId: p.cleanerId,
          startedAt: p.startedAt,
          endedAt: p.endedAt,
        },
      });
      created++;
    } catch (e) {
      console.error(`  failed on job #${p.jobNumber}`, e);
    }
  }
  console.log(`\nCreated ${created} session(s) across ${touchedJobs} job(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
