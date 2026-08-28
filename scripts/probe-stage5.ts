/**
 * Stage 5 — READ-ONLY probes for the cleaner job workflow round
 * (`_ai_context/TODO.md` items 12–15).
 *
 * Four questions the Stage 5 plan depends on, all answered against live data:
 *
 *   1. (item 12) duplicate JobChecklist (jobId, employeeId) rows — decides
 *      whether a @@unique index can ship. Generating a checklist on every page
 *      open makes today's read-then-write race far more likely; the constraint
 *      is the fix, but CREATE UNIQUE INDEX fails if duplicates already exist.
 *   2. (item 14) the JobAssignmentInvite population, split by flavour, plus the
 *      rows whose cleaner is no longer on the job (today those raise a spurious
 *      "still assigned — confirm or reassign" alert).
 *   3. (item 15) how many jobs carry a clock pair, and how many have per-cleaner
 *      JobAssignment rows to source it from — sizes the backfill.
 *   4. (item 15.d) the exact reported-hours delta from switching payroll from
 *      "one job span ÷ participants" to per-cleaner actuals.
 *
 * Every query is a read. Nothing here writes, and nothing that writes may be
 * added: verify-awer-fixes-3.ts holds this file to that mechanically.
 *
 *   npx tsx scripts/probe-stage5.ts
 */
import { PrismaClient } from "@prisma/client";
import { refuseOnMultiTenant } from "./_scope";

const db = new PrismaClient();

const pad = (label: string, width = 44) => label.padEnd(width, ".");

async function main() {
  // A diagnostic that mixes companies together reports nothing useful.
  await refuseOnMultiTenant(db, "probe-stage5.ts");

  console.log("Stage 5 — read-only probes  (no writes)\n");

  // ── Item 12 · can JobChecklist take a unique index? ──────────────────────
  const checklists = await db.jobChecklist.count();
  const checklistDupes = await db.$queryRaw<
    { jobId: string; employeeId: string; n: bigint }[]
  >`
    SELECT "jobId", "employeeId", COUNT(*)::bigint AS n
    FROM "JobChecklist"
    GROUP BY "jobId", "employeeId"
    HAVING COUNT(*) > 1
  `;
  const emptyChecklists = await db.jobChecklist.count({
    where: { items: { none: {} } },
  });
  const templates = await db.checklistTemplate.count({ where: { isActive: true } });
  const templateItems = await db.checklistTemplateItem.count();
  console.log("── Item 12 · checklist generation ──");
  console.log(`  ${pad("JobChecklist rows")} ${checklists}`);
  console.log(
    `  ${pad("duplicate (jobId, employeeId) pairs")} ${checklistDupes.length}` +
      `  ← 0 means the @@unique index can ship`
  );
  console.log(
    `  ${pad("checklists holding ZERO items")} ${emptyChecklists}` +
      `  ← these permanently block regeneration today`
  );
  console.log(`  ${pad("active ChecklistTemplate rows")} ${templates}`);
  console.log(`  ${pad("ChecklistTemplateItem rows")} ${templateItems}`);
  if (templates === 0) {
    console.log(
      "  ⚠️  no active templates: auto-generation will correctly produce NOTHING\n" +
        "      until an admin configures one (which is why 12.a must not create\n" +
        "      an empty JobChecklist row)."
    );
  }

  // ── Item 13 · how many jobs a cleaner could preview right now ────────────
  const claimable = await db.job.count({
    where: {
      deletedAt: null,
      status: { in: ["CREATED", "SCHEDULED"] },
      startTime: { gte: new Date() },
    },
  });
  console.log("\n── Item 13 · preview surface ──");
  console.log(`  ${pad("future CREATED/SCHEDULED jobs")} ${claimable}`);

  // ── Item 14 · the invite layer ───────────────────────────────────────────
  const invites = await db.jobAssignmentInvite.groupBy({
    by: ["decision", "isLastMinute"],
    _count: { _all: true },
  });
  console.log("\n── Item 14 · JobAssignmentInvite by flavour ──");
  if (!invites.length) console.log("  (none)");
  for (const row of invites.sort((a, b) => a.decision.localeCompare(b.decision))) {
    console.log(
      `  ${row.decision.padEnd(9)} ${
        row.isLastMinute ? "last-minute broadcast" : "direct assignment   "
      }  ${row._count._all}`
    );
  }
  const directPendingLapsed = await db.jobAssignmentInvite.count({
    where: { decision: "PENDING", isLastMinute: false, expiresAt: { lt: new Date() } },
  });
  console.log(
    `  ${pad("direct PENDING already past expiresAt")} ${directPendingLapsed}` +
      `  ← the sweep would stamp these EXPIRED tonight`
  );

  // Invites whose cleaner has since been taken off the job. The sweep only
  // checks job.deletedAt, so these produce an alert about somebody who is not
  // on the job at all.
  const orphanInvites = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM "JobAssignmentInvite" i
    JOIN "Job" j ON j.id = i."jobId"
    WHERE i."isLastMinute" = false
      AND j."deletedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "_JobCleaners" jc
        WHERE jc."A" = j.id AND jc."B" = i."cleanerId"
      )
      AND j."employeeId" IS DISTINCT FROM i."cleanerId"
  `;
  console.log(
    `  ${pad("direct invites whose cleaner LEFT the job")} ${orphanInvites[0].n}` +
      `  ← spurious "confirm or reassign" alerts`
  );

  // ── Item 15 · how much clock history exists to migrate ───────────────────
  const jobsTotal = await db.job.count();
  const jobsClockedIn = await db.job.count({ where: { clockInTime: { not: null } } });
  const jobsClockedOut = await db.job.count({ where: { clockOutTime: { not: null } } });
  const jobsOpen = await db.job.count({
    where: { clockInTime: { not: null }, clockOutTime: null },
  });
  const assignmentsWithClock = await db.jobAssignment.count({
    where: { clockInTime: { not: null } },
  });
  const assignmentsClosed = await db.jobAssignment.count({
    where: { clockInTime: { not: null }, clockOutTime: { not: null } },
  });
  // Jobs with a job-level clock pair but NO assignment row carrying one — these
  // are the legacy rows the backfill has to source from the job level.
  const legacyOnly = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM "Job" j
    WHERE j."clockInTime" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "JobAssignment" a
        WHERE a."jobId" = j.id AND a."clockInTime" IS NOT NULL
      )
  `;
  const breaks = await db.jobBreak.count();
  const openBreaks = await db.jobBreak.count({ where: { endedAt: null } });
  console.log("\n── Item 15 · clock history / backfill sizing ──");
  console.log(`  ${pad("Job rows")} ${jobsTotal}`);
  console.log(`  ${pad("jobs with a job-level clock-in")} ${jobsClockedIn}`);
  console.log(`  ${pad("jobs with a job-level clock-out")} ${jobsClockedOut}`);
  console.log(
    `  ${pad("jobs clocked in and never out")} ${jobsOpen}` +
      `  ← would become open sessions`
  );
  console.log(`  ${pad("JobAssignment rows with a clock-in")} ${assignmentsWithClock}`);
  console.log(`  ${pad("...of those, also clocked out")} ${assignmentsClosed}`);
  console.log(
    `  ${pad("jobs with ONLY a job-level pair")} ${legacyOnly[0].n}` +
      `  ← backfill keys these to employeeId`
  );
  console.log(`  ${pad("JobBreak rows")} ${breaks}  (${openBreaks} still running)`);

  // Resume candidates: a COMPLETED job is exactly what "clock back in" reopens.
  const completedWithClock = await db.job.count({
    where: { status: "COMPLETED", clockOutTime: { not: null } },
  });
  const paidWithClock = await db.job.count({
    where: { status: "PAID", clockOutTime: { not: null } },
  });
  console.log(
    `  ${pad("COMPLETED jobs with a clock-out")} ${completedWithClock}  ← resumable`
  );
  console.log(
    `  ${pad("PAID jobs with a clock-out")} ${paidWithClock}  ← must refuse resume`
  );

  // ── Item 15.d · the reported-hours delta ─────────────────────────────────
  // Today: hours = (job clock span − all breaks) ÷ participant count, given to
  // every participant. After: each cleaner gets their own assignment span minus
  // their own breaks. Only multi-cleaner jobs can move, so measure those.
  const multi = await db.job.findMany({
    where: {
      clockInTime: { not: null },
      clockOutTime: { not: null },
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
      breaks: { select: { cleanerId: true, startedAt: true, endedAt: true } },
    },
  });

  const hrs = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
  const breakHours = (
    rows: { startedAt: Date; endedAt: Date | null }[],
    within?: { start: Date; end: Date }
  ) =>
    rows.reduce((sum, b) => {
      if (!b.endedAt) return sum;
      let s = b.startedAt;
      let e = b.endedAt;
      if (within) {
        s = s > within.start ? s : within.start;
        e = e < within.end ? e : within.end;
      }
      return sum + Math.max(0, (e.getTime() - s.getTime()) / 3_600_000);
    }, 0);

  let oldTotal = 0;
  let newTotal = 0;
  let movedJobs = 0;
  let multiCleanerJobs = 0;
  const worstOffenders: { jobNumber: number; old: number; next: number }[] = [];

  for (const j of multi) {
    const participants = Array.from(
      new Set(
        [j.employeeId, ...j.cleaners.map((c) => c.id)].filter(
          (id): id is string => !!id
        )
      )
    );
    if (participants.length === 0) continue;
    if (participants.length > 1) multiCleanerJobs++;

    const jobSpan = hrs(j.clockInTime!, j.clockOutTime!);
    const oldPerPerson =
      Math.max(0, jobSpan - breakHours(j.breaks)) / participants.length;
    const oldJob = oldPerPerson * participants.length;

    let newJob = 0;
    for (const id of participants) {
      const a = j.assignments.find((x) => x.cleanerId === id);
      const start = a?.clockInTime ?? j.clockInTime!;
      const end = a?.clockOutTime ?? j.clockOutTime!;
      const mine = j.breaks.filter((b) => b.cleanerId === id);
      newJob += Math.max(
        0,
        hrs(start, end) - breakHours(mine, { start, end })
      );
    }

    oldTotal += oldJob;
    newTotal += newJob;
    if (Math.abs(newJob - oldJob) > 0.01) {
      movedJobs++;
      worstOffenders.push({ jobNumber: j.jobNumber, old: oldJob, next: newJob });
    }
  }

  worstOffenders.sort((a, b) => Math.abs(b.next - b.old) - Math.abs(a.next - a.old));

  console.log("\n── Item 15.d · reported-hours delta (money is NOT affected) ──");
  console.log(`  ${pad("jobs with a complete clock pair")} ${multi.length}`);
  console.log(`  ${pad("...of those, multi-cleaner")} ${multiCleanerJobs}`);
  console.log(`  ${pad("jobs whose reported hours move")} ${movedJobs}`);
  console.log(
    `  ${pad("total reported hours OLD → NEW")} ${oldTotal.toFixed(1)} → ${newTotal.toFixed(1)}` +
      `  (${newTotal - oldTotal >= 0 ? "+" : ""}${(newTotal - oldTotal).toFixed(1)}h)`
  );
  if (worstOffenders.length) {
    console.log("  largest movers:");
    for (const w of worstOffenders.slice(0, 8)) {
      console.log(
        `    job #${String(w.jobNumber).padStart(5)}  ${w.old.toFixed(2)}h → ${w.next.toFixed(2)}h`
      );
    }
  }
  console.log(
    "  NOTE: share.hours is reporting-only. HOURLY pay comes from employeePay,\n" +
      "  set at save time from hourlyRate x SCHEDULED hours (saveJob.ts), so no\n" +
      "  payout amount moves with this change."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
