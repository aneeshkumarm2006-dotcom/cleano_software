/**
 * Round 4, fix 7 — put the apartment number in the apartment column.
 *
 *   npx tsx scripts/backfillJobAptNumbers.ts           # dry-run (default)
 *   npx tsx scripts/backfillJobAptNumbers.ts --commit  # apply
 *
 * ## Why a script at all
 *
 * The code half of fix 7 already reads the unit out of the raw `location`
 * string at render time (`resolveAddressParts` → `splitAptFromLocation`), so
 * the cleaner's job page shows "Apt 23" on IMG-5's job with or without this
 * script. What the script buys is everything that ISN'T that one render path:
 * the column becomes true, so filters, exports, the address book, the invoice
 * and any future screen all see the unit without each re-deriving it from a
 * string. A derived value that only one screen derives is a fact that screen
 * happens to know; a column is a fact the business knows.
 *
 * ## What it changes
 *
 * Exactly one column, on rows where it is currently empty:
 *
 *   • not archived (`deletedAt` is null);
 *   • `aptNumber` is null or blank — a value somebody already typed is never
 *     overwritten, and this is also the re-run guard;
 *   • `location` holds a unit that `splitAptFromLocation` is willing to name.
 *
 * `location` itself is deliberately left ALONE. That is the safety property of
 * this script: it only fills a blank. Nothing is deleted, no string is
 * rewritten, and setting `aptNumber` back to null restores the exact prior
 * state. Rendering does not double up either — with the column filled, every
 * surface runs `stripDuplicatedApt`, which takes the now-redundant tail off the
 * street. Before and after, the screen reads the same; only the storage moves.
 *
 * ## Reversibility
 *
 * Every write logs an `UPDATED` job log naming the old (empty) value, the new
 * one and the string it came from, so the exact set of rows can be read back
 * out of the database and undone.
 */
import { PrismaClient } from "@prisma/client";
import { splitAptFromLocation } from "../src/lib/client-address";
import { refuseOnMultiTenant } from "./_scope";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

/** Stable prefix on the audit log, so the rows this run touched stay findable. */
const MARKER = "Apartment number recovered from the address (round 4, fix 7)";

async function main() {
  // Written when there was one company; its queries do not name one.
  await refuseOnMultiTenant(db, "backfillJobAptNumbers.ts");

  console.log(`backfillJobAptNumbers — ${commit ? "COMMIT" : "DRY RUN"}\n`);

  const rows = await db.job.findMany({
    where: {
      deletedAt: null,
      location: { not: null },
      // Blank counts as empty: an importer that wrote "" is as unhelpful as one
      // that wrote nothing, and neither is somebody's typed answer.
      OR: [{ aptNumber: null }, { aptNumber: "" }],
    },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      location: true,
      bookingSource: true,
    },
    orderBy: { jobNumber: "asc" },
  });

  const found = rows
    .map((j) => ({ job: j, split: splitAptFromLocation(j.location) }))
    .filter((r) => r.split.apt);

  console.log(`${rows.length} job(s) with an address and no apartment number`);
  console.log(`${found.length} of them carry a unit inside the address string\n`);

  if (found.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Grouped by the unit, because a dry run's whole job is to make a WRONG split
  // obvious at a glance — and a wrong rule shows up as a suspicious repeat (the
  // same "unit" recovered from thirty unrelated addresses) far faster than it
  // does row by row.
  const byApt = new Map<string, number>();
  for (const r of found) byApt.set(r.split.apt!, (byApt.get(r.split.apt!) ?? 0) + 1);
  console.log("Units recovered, most common first:");
  for (const [apt, n] of [...byApt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(n).padStart(4)} ×  ${JSON.stringify(apt)}`);
  }
  console.log("");

  for (const { job, split } of found) {
    console.log(`  #${job.jobNumber}  apt ${JSON.stringify(split.apt)}   ${job.clientName}`);
    console.log(`      from: ${JSON.stringify(job.location)}`);
    console.log(`      street becomes: ${JSON.stringify(split.street)}   (${job.bookingSource ?? "manual"})`);
  }

  console.log(
    `\n${found.length} row(s) to fill. \`location\` is not modified on any of them — ` +
      `this run only writes the aptNumber column.`
  );

  if (!commit) {
    console.log("\nDry run — nothing written. Re-run with --commit to apply.");
    return;
  }

  let n = 0;
  for (const { job, split } of found) {
    await db.$transaction([
      db.job.update({
        where: { id: job.id },
        data: { aptNumber: split.apt },
      }),
      db.jobLog.create({
        data: {
          jobId: job.id,
          // No session — this is a script. `JobLog.userId` is nullable exactly
          // for this case and the timeline renders it as a system entry.
          userId: null,
          action: "UPDATED",
          field: "aptNumber",
          oldValue: null,
          newValue: split.apt,
          description:
            `${MARKER}: read out of "${job.location}". ` +
            `The address itself is unchanged — the unit was only ever displayed ` +
            `at the end of that line, where it was easy to miss.`,
        },
      }),
    ]);
    n++;
  }

  console.log(`\nCommitted: ${n} job(s) given an aptNumber, each with an UPDATED log.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
