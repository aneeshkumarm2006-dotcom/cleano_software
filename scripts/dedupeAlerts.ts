/**
 * Collapse the duplicate Alert backlog (client feedback items 7, 25).
 *
 * WHY THIS EXISTS
 * Two bugs, both fixed in code as part of Stage 3, had been minting duplicate
 * alert rows for months:
 *
 *   1. `/admin/analytics` re-created an OVERDUE_PAYMENT alert on EVERY page
 *      load once the alert table held more than 50 undismissed rows — its
 *      "already alerted?" check scanned only the 50 most recent, so older jobs
 *      aged out of the window and were alerted again, and again. Some jobs had
 *      19 identical rows.
 *   2. `notifyAdmins()` wrote one row PER admin user, while the only reader
 *      (/admin/analytics → Alerts) queries without a recipient filter — so one
 *      logical alert rendered once per admin. This is the pair the client
 *      photographed: same title, same body, same timestamp.
 *
 * Fixing the code stops new duplicates; it does not clean what is already
 * there. This script does that.
 *
 * WHAT IT DOES
 * Groups UNDISMISSED alerts by full logical identity — type + title + message +
 * relatedId — keeps the newest row of each group active, and DISMISSES the
 * rest. It does not delete anything: dismissed rows stay in the table and out
 * of the UI, so the history survives and a mistake is reversible.
 *
 * Safe to re-run: a second pass finds nothing to do.
 *
 *   npx tsx scripts/dedupeAlerts.ts            # dry run — reports, changes nothing
 *   npx tsx scripts/dedupeAlerts.ts --apply    # commits the dismissals
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function identityKey(a: {
  type: string;
  title: string;
  message: string;
  relatedId: string | null;
}): string {
  return JSON.stringify([a.type, a.title, a.message, a.relatedId]);
}

async function main() {
  const alerts = await db.alert.findMany({
    where: { isDismissed: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      title: true,
      message: true,
      relatedId: true,
      recipientUserId: true,
      createdAt: true,
    },
  });

  const groups = new Map<string, typeof alerts>();
  for (const a of alerts) {
    const key = identityKey(a);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  // Newest-first ordering above means index 0 of each group is the keeper.
  const staleIds: string[] = [];
  const worst: { title: string; count: number }[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    worst.push({ title: group[0].title, count: group.length });
    for (const a of group.slice(1)) staleIds.push(a.id);
  }

  worst.sort((a, b) => b.count - a.count);

  console.log(`undismissed alerts        : ${alerts.length}`);
  console.log(`distinct logical alerts   : ${groups.size}`);
  console.log(`redundant copies          : ${staleIds.length}`);
  if (worst.length > 0) {
    console.log(`\nworst offenders:`);
    for (const w of worst.slice(0, 10)) {
      console.log(`  ×${String(w.count).padStart(3)}  ${w.title}`);
    }
  }

  if (staleIds.length === 0) {
    console.log(`\nNothing to do.`);
    await db.$disconnect();
    return;
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing was changed. Re-run with --apply to dismiss the ${staleIds.length} redundant rows.`,
    );
    await db.$disconnect();
    return;
  }

  // Chunked: a single updateMany with thousands of ids is a needlessly large
  // statement for a pooled connection.
  let dismissed = 0;
  const CHUNK = 500;
  for (let i = 0; i < staleIds.length; i += CHUNK) {
    const result = await db.alert.updateMany({
      where: { id: { in: staleIds.slice(i, i + CHUNK) } },
      data: { isDismissed: true },
    });
    dismissed += result.count;
  }
  console.log(`\nDismissed ${dismissed} redundant alert rows.`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
