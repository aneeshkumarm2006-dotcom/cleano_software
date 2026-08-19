/**
 * Round 4, fix 1 — repair jobs that are stamped done but haven't happened yet.
 *
 *   npx tsx scripts/fixFutureCompletedJobs.ts           # dry-run (default)
 *   npx tsx scripts/fixFutureCompletedJobs.ts --commit  # apply
 *
 * ## Why a script at all
 *
 * The code fixes in this round do two things: they stop the payment/import
 * writers from stamping a lifecycle status on work that has not happened, and
 * they add a read-side date guard so a mis-stamped row can never *display* as
 * completed. Neither heals the rows already in the database — and those rows
 * are not merely cosmetic. `COMPLETED` is in `CLEANER_CLOSED_STATUSES`
 * (src/lib/cleaner-jobs.ts), so a future job carrying it is filtered out of its
 * cleaner's upcoming list: the admin assigns the job, the cleaner never sees
 * it. That is fix 2 in the same PDF, and this script is most of its cure.
 *
 * ## What it changes
 *
 * A row qualifies when ALL of the following hold:
 *   • not archived (`deletedAt` is null);
 *   • `status` is COMPLETED or PAID;
 *   • `startTime` is still in the future;
 *   • `clockOutTime` is null — nobody clocked out of it, so there is no
 *     evidence any work was done. A future-dated job WITH a clock-out was
 *     genuinely worked (an early finish on a job booked for later today) and is
 *     deliberately left alone.
 *
 * Such a row is set back to `SCHEDULED`. Nothing else is touched — in
 * particular `paymentReceived`, `paidAt`, `stripePaymentIntentId` and every
 * money column are preserved, because the payment really did happen. Only the
 * claim that the WORK happened is withdrawn.
 *
 * ## Reversibility
 *
 * Every change writes a `STATUS_CHANGED` job log carrying the previous value
 * and the marker below, so the exact set of rows and their old statuses can be
 * read back out of the database afterwards. That log is also the re-run guard:
 * a row already repaired by this script is skipped, so running it twice cannot
 * compound.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

/** Stable prefix on the audit log — also the re-run guard. */
const MARKER = "Future-dated job reset to Scheduled (round 4, fix 1)";

const when = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) : "—";

async function main() {
  const now = new Date();
  console.log(
    `fixFutureCompletedJobs — ${commit ? "COMMIT" : "DRY RUN"}  (now = ${now.toISOString()})\n`
  );

  const candidates = await db.job.findMany({
    where: {
      deletedAt: null,
      status: { in: ["COMPLETED", "PAID"] },
      startTime: { gt: now },
      // No clock-out ⇒ no evidence of work. See the header.
      clockOutTime: null,
    },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      status: true,
      startTime: true,
      paymentReceived: true,
      paidAt: true,
      bookingSource: true,
      price: true,
      employeeId: true,
      cleaners: { select: { id: true, name: true } },
      logs: {
        where: { action: "STATUS_CHANGED", description: { startsWith: MARKER } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { startTime: "asc" },
  });

  const already = candidates.filter((j) => j.logs.length > 0);
  const todo = candidates.filter((j) => j.logs.length === 0);

  console.log(`${candidates.length} future-dated job(s) stamped COMPLETED/PAID with no clock-out`);
  if (already.length) {
    console.log(`  ${already.length} already repaired by a previous run — skipping`);
  }
  console.log("");

  if (todo.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const j of todo) {
    const crew = j.cleaners.map((c) => c.name).join(", ") || (j.employeeId ? "(lead only)" : "unassigned");
    console.log(
      `  #${j.jobNumber}  ${j.status.padEnd(9)} → SCHEDULED   starts ${when(j.startTime)}` +
        `   paid=${j.paymentReceived}   $${(j.price ?? 0).toFixed(2)}`
    );
    console.log(`      ${j.clientName}   crew: ${crew}   id=${j.id}`);
    // The reason this matters beyond the pill: these are the rows fix 2 is
    // about. Say so per row, so the review of a dry run is self-explaining.
    //
    // The wording was "currently hidden from this cleaner's upcoming list"
    // until Stage 6 — true when this script was written, and false by the time
    // anyone would run it. Stage 2 hardened the READ side, so the job reaches
    // its cleaner while the row is still stamped COMPLETED; verified in the
    // app on this very row (Annabel Karim's profile leads with it). Leaving
    // the old sentence in would have overstated the urgency of a `--commit`
    // against a live database, which is the last thing a dry run should do.
    if (j.status === "COMPLETED" && (j.cleaners.length > 0 || j.employeeId)) {
      console.log(
        `      ⚠ COMPLETED + assigned ⇒ reaches the cleaner (Stage 2's read guard), but reads as done on admin surfaces`
      );
    }
  }

  // Payment state is preserved, so say what is NOT changing as loudly as what is.
  const stillPaid = todo.filter((j) => j.paymentReceived).length;
  console.log(
    `\n${todo.length} row(s) to reset. ` +
      `${stillPaid} of them are paid — payment flags, paidAt and all money columns are left untouched.`
  );

  if (!commit) {
    console.log("\nDry run — nothing written. Re-run with --commit to apply.");
    return;
  }

  let n = 0;
  for (const j of todo) {
    // Per row rather than one updateMany: each change needs its own log
    // carrying that row's OLD status, which is what makes this reversible.
    await db.$transaction([
      db.job.update({
        where: { id: j.id },
        data: { status: "SCHEDULED" },
      }),
      db.jobLog.create({
        data: {
          jobId: j.id,
          // No session — this is a script. `JobLog.userId` is nullable exactly
          // for this case and the timeline renders it as a system entry.
          userId: null,
          action: "STATUS_CHANGED",
          field: "status",
          oldValue: j.status,
          newValue: "SCHEDULED",
          description:
            `${MARKER}: the job starts ${when(j.startTime)} and was never clocked out, ` +
            `so "${j.status}" could not have been earned. Payment state is unchanged` +
            `${j.paymentReceived ? " (this job remains marked paid)" : ""}.`,
        },
      }),
    ]);
    n++;
  }

  console.log(`\nCommitted: ${n} job(s) reset to SCHEDULED, each with a STATUS_CHANGED log.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
