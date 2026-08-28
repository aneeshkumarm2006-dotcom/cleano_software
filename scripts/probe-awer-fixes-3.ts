/**
 * Stage 0.3 — READ-ONLY baseline probes for the third AWER fixes round.
 *
 * Every query here is a read. Nothing writes, and nothing may be added to this
 * file that does: the numbers it prints are the blast-radius record the TODO
 * signs off against, so it must be safe to re-run against the live database at
 * any point in the round.
 *
 *   npx tsx scripts/probe-awer-fixes-3.ts
 */
import { PrismaClient } from "@prisma/client";
import { normalizeJobType } from "../src/lib/calendar-labels";
import { BILLING_LINE_SOURCE } from "../src/lib/cleaner-notes";
import { refuseOnMultiTenant } from "./_scope";

const db = new PrismaClient();

/**
 * The billing-line vocabulary `sanitizeCleanerNotes` hides cleaner-side, BUILT
 * FROM the same exported source string rather than hand-copied — this used to
 * be a third independent copy that could drift from the two in
 * src/lib/cleaner-notes.ts without anything noticing.
 *
 * Re-expressed as a Postgres regex so the count is done in the database rather
 * than by pulling every note into memory. Applied with the `n` flag so `^`/`$`
 * mean line, not string — a note qualifies if ANY of its lines is billing text,
 * which is exactly what fix 15 has to strip. JS `\b` becomes Postgres `\y`,
 * which is the same word-boundary assertion.
 *
 * Importing a string is not a database write, so the read-only guard that
 * verify-awer-fixes-3.ts holds this file to is unaffected.
 */
const BILLING_LINE_SQL = `(?in)(${BILLING_LINE_SOURCE.replace(/\\b/g, "\\y")})`;

async function main() {
  // A diagnostic that mixes companies together reports nothing useful.
  await refuseOnMultiTenant(db, "probe-awer-fixes-3.ts");

  console.log("Stage 0.3 — read-only probes  (no writes)\n");

  // ── Fix 15 · how many jobs carry billing text in cleaner-visible notes ────
  const [{ total_jobs, with_notes, billing_notes, legacy_startswith }] =
    await db.$queryRaw<
      {
        total_jobs: bigint;
        with_notes: bigint;
        billing_notes: bigint;
        legacy_startswith: bigint;
      }[]
    >`
      SELECT
        COUNT(*)                                                    AS total_jobs,
        COUNT(*) FILTER (WHERE notes IS NOT NULL AND notes <> '')    AS with_notes,
        COUNT(*) FILTER (WHERE notes ~ ${BILLING_LINE_SQL})          AS billing_notes,
        COUNT(*) FILTER (WHERE notes LIKE 'Source Booking ID%'
                            OR notes LIKE 'Imported from BookingKoala%')
                                                                     AS legacy_startswith
      FROM "Job"
    `;
  console.log("── Fix 15 · billing text in Job.notes ──");
  console.log(`  jobs total ................................ ${total_jobs}`);
  console.log(`  with any notes ............................ ${with_notes}`);
  console.log(`  notes matching the billing regex .......... ${billing_notes}`);
  console.log(`  caught by today's startsWith filter ....... ${legacy_startswith}`);
  console.log(
    `  MISSED by today's filter .................. ${
      Number(billing_notes) - Number(legacy_startswith)
    }  ← the 9.a gap`
  );

  // A redacted sample, so the shape is visible without printing customer data.
  const sample = await db.$queryRaw<{ notes: string }[]>`
    SELECT notes FROM "Job"
    WHERE notes ~ ${BILLING_LINE_SQL}
      AND notes NOT LIKE 'Source Booking ID%'
      AND notes NOT LIKE 'Imported from BookingKoala%'
    LIMIT 5
  `;
  if (sample.length) {
    console.log("  sample of the missed rows (first line, truncated):");
    for (const s of sample) {
      console.log(`    · ${s.notes.split(/\r?\n/)[0].slice(0, 90)}…`);
    }
  }

  // ── Fix 4 · the invite layer the client experiences as a 10-minute hold ───
  const invites = await db.jobAssignmentInvite.groupBy({
    by: ["decision", "isLastMinute"],
    _count: { _all: true },
  });
  console.log("\n── Fix 4 · JobAssignmentInvite rows by decision ──");
  if (!invites.length) console.log("  (none)");
  for (const row of invites.sort((a, b) =>
    a.decision.localeCompare(b.decision)
  )) {
    console.log(
      `  ${row.decision.padEnd(9)} ${
        row.isLastMinute ? "last-minute broadcast" : "direct assignment   "
      }  ${row._count._all}`
    );
  }
  const stillPending = await db.jobAssignmentInvite.count({
    where: { decision: "PENDING", expiresAt: { lt: new Date() } },
  });
  console.log(`  PENDING rows already past expiresAt ....... ${stillPending}`);

  // ── Fix 3 · what jobType strings actually exist, for the category map ────
  const types = await db.job.groupBy({
    by: ["jobType"],
    _count: { _all: true },
    orderBy: { _count: { jobType: "desc" } },
  });
  console.log(`\n── Fix 3 · distinct Job.jobType values (${types.length}) ──`);
  let mapped = 0;
  let unmapped = 0;
  for (const t of types) {
    const raw = t.jobType ?? null;
    const category = normalizeJobType(raw);
    if (category) mapped += t._count._all;
    else unmapped += t._count._all;
    console.log(
      `  ${String(raw ?? "(null)").padEnd(30)} ${String(t._count._all).padStart(4)}` +
        `  → ${category ?? "UNMAPPED  ←"}`
    );
  }
  console.log(
    `  jobs whose jobType folds to a category .... ${mapped}` +
      `\n  jobs with NO category ..................... ${unmapped}` +
      `  ← 16.c would hide these from every restricted cleaner`
  );

  // ── Fix 7 · how many rows the JobAddOn.quantity migration touches ────────
  const addOns = await db.jobAddOn.count();
  const addOnJobs = await db.jobAddOn.groupBy({ by: ["jobId"] });
  const dupes = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT "jobId", lower(name) FROM "JobAddOn"
      GROUP BY "jobId", lower(name) HAVING COUNT(*) > 1
    ) d
  `;
  const zeroPriced = await db.jobAddOn.count({ where: { price: 0 } });
  console.log("\n── Fix 7 · JobAddOn blast radius ──");
  console.log(`  JobAddOn rows ............................. ${addOns}`);
  console.log(`  jobs holding at least one add-on .......... ${addOnJobs.length}`);
  console.log(`  (job, name) pairs already duplicated ...... ${dupes[0].n}  ← today's stand-in for quantity`);
  console.log(`  rows priced at $0 ......................... ${zeroPriced}`);

  const names = await db.jobAddOn.groupBy({
    by: ["name"],
    _count: { _all: true },
    orderBy: { _count: { name: "desc" } },
    take: 15,
  });
  if (names.length) {
    console.log("  most common add-on names:");
    for (const n of names) console.log(`    ${n.name.padEnd(34)} ${n._count._all}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
