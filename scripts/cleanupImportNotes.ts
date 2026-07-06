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
    select: { id: true, notes: true, clientName: true },
  });

  console.log(`${jobs.length} job(s) with legacy import notes`);
  for (const j of jobs.slice(0, 3)) {
    console.log(`  e.g. ${j.clientName}: ${j.notes?.slice(0, 80)}…`);
  }
  if (!commit) {
    console.log("Dry-run only — rerun with --commit to apply.");
    return;
  }

  let moved = 0;
  for (const j of jobs) {
    await db.$transaction([
      db.jobLog.create({
        data: {
          jobId: j.id,
          action: "NOTE_ADDED",
          field: "notes",
          description: `Import traceability (moved from cleaner-visible notes): ${j.notes}`,
        },
      }),
      db.job.update({ where: { id: j.id }, data: { notes: null } }),
    ]);
    moved++;
  }
  console.log(`Moved ${moved} note(s) to admin-only job logs and cleared them.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
