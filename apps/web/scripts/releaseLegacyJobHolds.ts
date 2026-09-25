/**
 * Round 4, fix 6 — clear the legacy "On hold" backlog, and give a reason to
 * every hold that stays.
 *
 *   npx tsx scripts/releaseLegacyJobHolds.ts           # dry-run (default)
 *   npx tsx scripts/releaseLegacyJobHolds.ts --commit  # apply
 *
 * ## Why a script at all
 *
 * `JobStatus.CREATED` is the Prisma default, and until this round `saveJob`
 * never set a status — so every job an admin ever created was born CREATED,
 * which the calendar renders as "On hold". The code fix stamps SCHEDULED
 * explicitly from now on, which makes CREATED MEAN on hold going forward. It
 * does nothing for the rows already stored: without this script the app would
 * suddenly describe a large pile of perfectly ordinary bookings as held, and
 * the two holds that actually mean something would still be invisible in them.
 *
 * ## What it changes
 *
 * Every non-archived `CREATED` job is classified into exactly one of four:
 *
 *   QUOTE     `quoteStatus` is PENDING_REVIEW / QUOTED / DECLINED — a real
 *             hold. Stays CREATED; gets the matching reason. (An ACCEPTED
 *             quote is an ordinary job and is released with the rest.)
 *   FLEXIBLE  `isFlexible` — the customer booked "any day", so there is no date
 *             to schedule against. Stays CREATED with the flexible reason.
 *   ZERO      the booking is worth nothing — no price, no subtotal, no total.
 *             This is the $0 BookingKoala import the client asked about. Stays
 *             CREATED with the import reason.
 *   RELEASE   everything else: an ordinary booking that only ever looked held
 *             because of the enum default. → SCHEDULED, `holdReason` null.
 *
 * The three that stay only ever gain a `holdReason`; their status is untouched.
 * Nothing else is written — no price, total, tax, payout, payment, crew or date
 * column is read for anything but classification, and none is updated. That is
 * the same rule `fixFutureCompletedJobs.ts` follows.
 *
 * ## Order of operations (and why ZERO is tested last)
 *
 * A post-construction quote is unpriced BY DEFINITION — that is what a quote
 * request is — so it would match ZERO as readily as QUOTE. Testing the specific
 * causes before the generic one is what stops every quote in the business being
 * labelled "imported with $0 total".
 *
 * ## Reversibility
 *
 * A RELEASE writes a `STATUS_CHANGED` job log carrying the old status and the
 * marker below, so the exact set of released rows can be read back out
 * afterwards; the log is also the re-run guard. A reason-only write logs
 * nothing — no status changed, and a job log per row would be noise on a column
 * that was blank because it did not exist yet. Re-running is safe either way:
 * a reason is only written where one is missing.
 */
import { PrismaClient } from "@prisma/client";
import { HOLD_REASON } from "../src/lib/job-hold";
import { refuseOnMultiTenant } from "./_scope";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

/** Stable prefix on the audit log — also the re-run guard. */
const MARKER = "Legacy hold released (round 4, fix 6)";

const when = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) : "—";

type Bucket = "QUOTE" | "FLEXIBLE" | "ZERO" | "RELEASE";

const BUCKET_REASON: Record<Exclude<Bucket, "RELEASE">, string> = {
  QUOTE: HOLD_REASON.QUOTE_PENDING,
  FLEXIBLE: HOLD_REASON.FLEXIBLE_DATE,
  ZERO: HOLD_REASON.IMPORT_ZERO_TOTAL,
};

async function main() {
  // Written when there was one company; its queries do not name one.
  await refuseOnMultiTenant(db, "releaseLegacyJobHolds.ts");

  const now = new Date();
  console.log(
    `releaseLegacyJobHolds — ${commit ? "COMMIT" : "DRY RUN"}  (now = ${now.toISOString()})\n`
  );

  const held = await db.job.findMany({
    where: { deletedAt: null, status: "CREATED" },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      startTime: true,
      isFlexible: true,
      quoteStatus: true,
      holdReason: true,
      price: true,
      subtotalAmount: true,
      totalAmount: true,
      bookingSource: true,
      employeeId: true,
      cleaners: { select: { id: true } },
      logs: {
        where: { action: "STATUS_CHANGED", description: { startsWith: MARKER } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { startTime: "asc" },
  });

  console.log(`${held.length} non-archived job(s) currently CREATED (= on hold)\n`);
  if (held.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const classify = (j: (typeof held)[number]): Bucket => {
    // Specific causes first — see the header. A DECLINED quote is still a
    // quote-shaped hold: the booking is dead and needs a decision, not a crew.
    if (
      j.quoteStatus === "PENDING_REVIEW" ||
      j.quoteStatus === "QUOTED" ||
      j.quoteStatus === "DECLINED"
    ) return "QUOTE";
    if (j.isFlexible) return "FLEXIBLE";
    // Worth nothing on every money column the importer writes. All three,
    // because a job can carry a subtotal with a null `price` (web bookings) or
    // a total with neither (an override), and any one of those is a real
    // booking that must not be mistaken for the $0 import case.
    if (!(j.price ?? 0) && !(j.subtotalAmount ?? 0) && !(j.totalAmount ?? 0)) return "ZERO";
    return "RELEASE";
  };

  const byBucket = new Map<Bucket, typeof held>();
  for (const j of held) {
    const b = classify(j);
    byBucket.set(b, [...(byBucket.get(b) ?? []), j]);
  }

  const release = (byBucket.get("RELEASE") ?? []).filter((j) => j.logs.length === 0);
  const alreadyReleased = (byBucket.get("RELEASE") ?? []).length - release.length;

  for (const bucket of ["QUOTE", "FLEXIBLE", "ZERO"] as const) {
    const rows = byBucket.get(bucket) ?? [];
    const needReason = rows.filter((j) => !j.holdReason?.trim());
    console.log(
      `${bucket.padEnd(9)} ${String(rows.length).padStart(4)} stay on hold` +
        `   (${needReason.length} need a reason written)`
    );
    for (const j of needReason.slice(0, 10)) {
      console.log(`             #${j.jobNumber}  ${when(j.startTime)}  ${j.clientName}`);
    }
    if (needReason.length > 10) console.log(`             …and ${needReason.length - 10} more`);
  }

  console.log(
    `\nRELEASE   ${String(release.length).padStart(4)} → SCHEDULED` +
      (alreadyReleased ? `   (${alreadyReleased} already released by a previous run — skipping)` : "")
  );
  for (const j of release.slice(0, 25)) {
    const crew = j.cleaners.length || j.employeeId ? "assigned" : "unassigned";
    console.log(
      `             #${j.jobNumber}  ${when(j.startTime)}  ${j.clientName}` +
        `   $${(j.price ?? j.subtotalAmount ?? 0).toFixed(2)}   ${crew}   ${j.bookingSource ?? "admin"}`
    );
  }
  if (release.length > 25) console.log(`             …and ${release.length - 25} more`);

  if (!commit) {
    console.log("\nDry run — nothing written. Re-run with --commit to apply.");
    return;
  }

  let reasons = 0;
  for (const bucket of ["QUOTE", "FLEXIBLE", "ZERO"] as const) {
    for (const j of byBucket.get(bucket) ?? []) {
      // Only where it is missing: an admin (or a producer) may have written a
      // better, more specific reason since, and a backfill must not overwrite
      // a human's words with a guess.
      if (j.holdReason?.trim()) continue;
      await db.job.update({
        where: { id: j.id },
        data: { holdReason: BUCKET_REASON[bucket] },
      });
      reasons++;
    }
  }

  let released = 0;
  for (const j of release) {
    // Per row rather than one updateMany: each release needs its own log
    // carrying that row's old status, which is what makes it reversible.
    await db.$transaction([
      db.job.update({
        where: { id: j.id },
        data: { status: "SCHEDULED", holdReason: null },
      }),
      db.jobLog.create({
        data: {
          jobId: j.id,
          // No session — this is a script. `JobLog.userId` is nullable exactly
          // for this case and the timeline renders it as a system entry.
          userId: null,
          action: "STATUS_CHANGED",
          field: "status",
          oldValue: "CREATED",
          newValue: "SCHEDULED",
          description:
            `${MARKER}: this booking was never deliberately held — it carried the ` +
            `CREATED default because the job form did not set a status. It is not a ` +
            `quote, not flexible, and is priced, so it is ordinary scheduled work.`,
        },
      }),
    ]);
    released++;
  }

  console.log(
    `\nCommitted: ${released} job(s) released to SCHEDULED, ${reasons} hold reason(s) written.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
