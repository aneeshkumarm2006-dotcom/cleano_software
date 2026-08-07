/**
 * One-time cleanup (awerfixes item 15): legacy BookingKoala imports stored
 * billing + traceability text in Job.notes, which cleaners and customers can
 * see. Newer imports write that text to an admin-only NOTE_ADDED job log
 * instead (see bookingkoala/core.ts).
 *
 *   npx tsx scripts/cleanupImportNotes.ts           # dry-run (counts + samples)
 *   npx tsx scripts/cleanupImportNotes.ts --commit  # apply
 *
 * ## Two things this used to get wrong
 *
 * 1. Its selector was `startsWith("Source Booking ID" | "Imported from
 *    BookingKoala")`. A live probe (2026-08-06) found that matched **0 of the
 *    205 affected rows** — the real shape is a single " | "-separated line that
 *    starts "Provider/team: …". So it has always been a no-op. Selection is now
 *    "every row with notes", filtered in memory by the shared rule, which also
 *    means there is exactly one place to get the vocabulary wrong.
 *
 * 2. It set `notes: null` unconditionally, destroying the whole field. That
 *    would have wiped the "Add-ons: …" segment the importer deliberately keeps
 *    — the very text item 9 says to preserve. It now strips ONLY the billing
 *    segments and writes back whatever survives.
 *
 * The rule itself is `stripBillingSegments` in src/lib/cleaner-notes.ts, so it
 * can be tested before it ever touches a live row. This file is only the
 * database wrapper.
 *
 * Re-running is safe: rows already processed carry the marker below in a job
 * log and are skipped.
 */
import { PrismaClient } from "@prisma/client";
import { hasBillingSegments, stripBillingSegments } from "../src/lib/cleaner-notes";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

/** Stable prefix on the preservation log — also the re-run guard. */
const ORIGINAL_MARKER = "Import billing text stripped from cleaner-visible notes.";

async function main() {
  // Every row with notes; the shared rule decides. A Prisma `OR` of `contains`
  // clauses would be a SECOND copy of the vocabulary to keep in sync, and the
  // whole table is ~200 rows.
  const jobs = await db.job.findMany({
    where: { notes: { not: null } },
    select: {
      id: true,
      notes: true,
      clientName: true,
      stripePaymentIntentId: true,
      logs: {
        where: { action: "NOTE_ADDED", description: { startsWith: ORIGINAL_MARKER } },
        select: { id: true },
        take: 1,
      },
    },
  });

  const affected = jobs
    // Selected on "does this note CONTAIN billing text", not on
    // "does stripping change the string" — the latter also fires on pure CRLF
    // normalisation and would rewrite clean rows for nothing. Rows already
    // processed by an earlier --commit carry the marker log and are skipped, so
    // re-running is a no-op.
    .filter((j) => hasBillingSegments(j.notes) && j.logs.length === 0)
    .map((j) => ({ job: j, kept: stripBillingSegments(j.notes) }));

  const emptied = affected.filter(({ kept }) => kept === null).length;
  const withPi = affected.filter(
    ({ job }) =>
      job.notes?.match(/Transaction ID:\s*pi_\S+/) && !job.stripePaymentIntentId
  ).length;

  console.log(
    `${jobs.length} job(s) carry notes.\n` +
      `${affected.length} would change (${emptied} become empty, ` +
      `${affected.length - emptied} keep some genuine text).\n` +
      `${withPi} carry a Stripe payment ID to backfill.`
  );

  // Full before/after on a few rows. A one-way write to live data should not be
  // approved from a count alone — preferring a sample that KEEPS text, since
  // that is where a bad rule does its damage.
  const samples = [
    ...affected.filter(({ kept }) => kept !== null).slice(0, 2),
    ...affected.filter(({ kept }) => kept === null).slice(0, 1),
  ].slice(0, 3);
  for (const { job, kept } of samples) {
    console.log(`\n  — ${job.clientName} (${job.id})`);
    console.log(`    BEFORE: ${JSON.stringify(job.notes)}`);
    console.log(`    AFTER:  ${JSON.stringify(kept)}`);
  }

  // Every distinct segment that SURVIVES, with a count. This is the review that
  // matters: a residue here is either genuine service info (keep it) or a label
  // the rule has not learned yet (add it), and neither is visible from a count
  // or from three samples.
  const survivors = new Map<string, number>();
  for (const { kept } of affected) {
    for (const seg of (kept ?? "").split("\n")) {
      const s = seg.trim();
      if (s) survivors.set(s, (survivors.get(s) ?? 0) + 1);
    }
  }
  if (survivors.size > 0) {
    console.log(`\n  Surviving segments (${survivors.size} distinct):`);
    for (const [seg, n] of [...survivors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)) {
      console.log(`    ${String(n).padStart(4)} × ${seg.slice(0, 96)}`);
    }
    if (survivors.size > 25) {
      console.log(`    …and ${survivors.size - 25} more distinct segment(s)`);
    }
  }

  if (!commit) {
    console.log(
      "\nDry-run only — read the before/after samples and the surviving segments\n" +
        "above, then rerun with --commit to apply."
    );
    return;
  }

  let moved = 0;
  let backfilled = 0;
  for (const { job, kept } of affected) {
    // Legacy notes carry the Stripe PaymentIntent ("Transaction ID: pi_…") —
    // backfill it onto the job's proper column before stripping the note.
    const pi = job.notes?.match(/Transaction ID:\s*(pi_\S+)/)?.[1] ?? null;
    const backfillPi = pi && !job.stripePaymentIntentId;
    if (backfillPi) backfilled++;
    await db.$transaction([
      db.jobLog.create({
        data: {
          jobId: job.id,
          action: "NOTE_ADDED",
          field: "notes",
          // The FULL original, verbatim — this log is the only thing standing
          // behind a one-way write.
          description: `${ORIGINAL_MARKER} Original: ${job.notes}`,
        },
      }),
      db.job.update({
        where: { id: job.id },
        data: {
          notes: kept,
          ...(backfillPi ? { stripePaymentIntentId: pi } : {}),
        },
      }),
    ]);
    moved++;
  }
  console.log(
    `Stripped billing text from ${moved} note(s) (originals preserved in admin-only job logs); ` +
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
