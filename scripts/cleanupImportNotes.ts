/**
 * One-time cleanup: legacy BookingKoala imports stored internal traceability
 * text ("Source Booking ID: … | Transaction ID: … | Provider/team: …") in
 * Job.notes, which cleaners and customers can see. Newer imports write that
 * text to an admin-only NOTE_ADDED job log instead (see bookingkoala/core.ts).
 *
 * This script moves the legacy text to a NOTE_ADDED job log (so nothing is
 * lost) and clears Job.notes. Run with --commit to write; default is dry-run.
 *
 *   npx tsx scripts/cleanupImportNotes.ts           # dry-run (count + sample)
 *   npx tsx scripts/cleanupImportNotes.ts --commit  # apply
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

async function main() {
  const jobs = await db.job.findMany({
    where: {
      OR: [
        { notes: { startsWith: "Source Booking ID" } },
        { notes: { startsWith: "Imported from BookingKoala" } },
      ],
    },
    select: {
      id: true,
      notes: true,
      clientName: true,
      stripePaymentIntentId: true,
    },
  });

  const withPi = jobs.filter(
    (j) => j.notes?.match(/Transaction ID:\s*pi_\S+/) && !j.stripePaymentIntentId
  ).length;
  console.log(
    `${jobs.length} job(s) with legacy import notes; ${withPi} carry a Stripe payment ID to backfill`
  );
  for (const j of jobs.slice(0, 3)) {
    console.log(`  e.g. ${j.clientName}: ${j.notes?.slice(0, 80)}…`);
  }
  if (!commit) {
    console.log("Dry-run only — rerun with --commit to apply.");
    return;
  }

  let moved = 0;
  let backfilled = 0;
  for (const j of jobs) {
    // Legacy notes carry the Stripe PaymentIntent ("Transaction ID: pi_…") —
    // backfill it onto the job's proper column before clearing the note.
    const pi = j.notes?.match(/Transaction ID:\s*(pi_\S+)/)?.[1] ?? null;
    const backfillPi = pi && !j.stripePaymentIntentId;
    if (backfillPi) backfilled++;
    await db.$transaction([
      db.jobLog.create({
        data: {
          jobId: j.id,
          action: "NOTE_ADDED",
          field: "notes",
          description: `Import traceability (moved from cleaner-visible notes): ${j.notes}`,
        },
      }),
      db.job.update({
        where: { id: j.id },
        data: {
          notes: null,
          ...(backfillPi ? { stripePaymentIntentId: pi } : {}),
        },
      }),
    ]);
    moved++;
  }
  console.log(
    `Moved ${moved} note(s) to admin-only job logs and cleared them; ` +
      `backfilled ${backfilled} Stripe payment ID(s) onto jobs.`
  );
}

/**
 * Recovery pass: notes already moved to job logs by an earlier run of this
 * script (before the backfill existed) may still carry a Stripe PaymentIntent
 * that never reached Job.stripePaymentIntentId. Scan those logs and backfill.
 */
async function backfillFromLogs() {
  const logs = await db.jobLog.findMany({
    where: {
      action: "NOTE_ADDED",
      description: { contains: "Transaction ID: pi_" },
    },
    select: { jobId: true, description: true },
  });

  const byJob = new Map<string, string>();
  for (const l of logs) {
    const pi = l.description.match(/Transaction ID:\s*(pi_\S+)/)?.[1];
    if (pi) byJob.set(l.jobId, pi);
  }
  if (byJob.size === 0) {
    console.log("Recovery pass: no payment IDs found in job logs.");
    return;
  }

  const jobs = await db.job.findMany({
    where: { id: { in: [...byJob.keys()] }, stripePaymentIntentId: null },
    select: { id: true },
  });
  console.log(
    `Recovery pass: ${jobs.length} job(s) missing a payment ID that exists in their logs.`
  );
  if (!commit) return;

  let n = 0;
  for (const j of jobs) {
    await db.job.update({
      where: { id: j.id },
      data: { stripePaymentIntentId: byJob.get(j.id) },
    });
    n++;
  }
  console.log(`Recovery pass: backfilled ${n} payment ID(s) from job logs.`);
}

main()
  .then(backfillFromLogs)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
