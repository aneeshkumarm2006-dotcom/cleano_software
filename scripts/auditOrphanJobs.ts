/**
 * Count the bookings that have no customer record (client feedback item 4,
 * Stage 4.7).
 *
 * WHY THIS EXISTS
 * `Job.clientId` was left null by every booking made through JobModal — the
 * Jobs page's "+ New job", the calendar create flow, and every Edit button —
 * because the shared `actions/saveJob` had no `db.client.create` at all. Only
 * the full-page `/admin/jobs/new` form ever created the profile.
 *
 * That is not a cosmetic gap. Every customer-facing email in the admin is
 * gated on `job.client?.email` and SILENTLY no-ops when it is missing: receipt,
 * cancellation, card-hold, refund, no-show, reschedule and rating emails, plus
 * off-session charging. An orphaned job is a customer nobody can reach, with no
 * warning anywhere in the UI.
 *
 * Stage 4.2 fixed the cause. This reports the backlog it left behind, so the
 * owner knows the size of it before deciding what to do. The per-job repair is
 * the "Link to client" control on the job detail page.
 *
 * READ ONLY. It writes nothing, takes no flags, and is safe to run any time.
 *
 *   npx tsx scripts/auditOrphanJobs.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const [total, orphans] = await Promise.all([
    db.job.count({ where: { deletedAt: null } }),
    db.job.findMany({
      where: { deletedAt: null, clientId: null },
      orderBy: { startTime: "desc" },
      select: {
        jobNumber: true,
        clientName: true,
        location: true,
        startTime: true,
        status: true,
        bookingSource: true,
        totalAmount: true,
      },
    }),
  ]);

  console.log(`Active jobs:            ${total}`);
  console.log(
    `Without a client row:   ${orphans.length}` +
      (total > 0
        ? `  (${((orphans.length / total) * 100).toFixed(1)}%)`
        : "")
  );

  if (orphans.length === 0) {
    console.log("\nNothing to repair.");
    return;
  }

  // Grouped by source first — that is what says whether the modal was the
  // cause, or whether an importer contributes too.
  const bySource = new Map<string, number>();
  for (const j of orphans) {
    const k = j.bookingSource ?? "(none — admin form)";
    bySource.set(k, (bySource.get(k) ?? 0) + 1);
  }
  console.log("\nBy booking source:");
  for (const [source, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${source}`);
  }

  // Same name typed more than once = one customer, several unreachable
  // bookings. Linking those is the highest-value repair per click.
  const byName = new Map<string, number>();
  for (const j of orphans) {
    const k = (j.clientName || "(blank)").trim().toLowerCase();
    byName.set(k, (byName.get(k) ?? 0) + 1);
  }
  const repeats = [...byName].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  if (repeats.length > 0) {
    console.log(
      `\nNames appearing on more than one orphaned job (${repeats.length}):`
    );
    for (const [name, n] of repeats.slice(0, 20)) {
      console.log(`  ${String(n).padStart(5)}  ${name}`);
    }
    if (repeats.length > 20) console.log(`  … ${repeats.length - 20} more`);
  }

  const unreachableValue = orphans.reduce((s, j) => s + (j.totalAmount ?? 0), 0);
  console.log(
    `\nBooked value on orphaned jobs: $${unreachableValue.toFixed(2)}`
  );

  console.log("\n20 most recent:");
  for (const j of orphans.slice(0, 20)) {
    console.log(
      `  #${String(j.jobNumber).padEnd(6)} ${j.startTime
        .toISOString()
        .slice(0, 10)}  ${String(j.status).padEnd(10)} ${j.clientName}` +
        (j.location ? ` — ${j.location}` : "")
    );
  }

  console.log(
    "\nRepair: open the job and use Link to client on the Details tab."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
