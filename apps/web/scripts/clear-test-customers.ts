/**
 * Wipes ALL data for the given customer emails so they can be re-imported clean.
 * Dry-run by default (prints what it would delete). Pass --commit to delete.
 *
 *   npx tsx scripts/clear-test-customers.ts                 # preview
 *   npx tsx scripts/clear-test-customers.ts --commit        # delete
 *
 * Deletes, per email: their Jobs (+ cascaded job children), CRM Contact,
 * Client record (+ cascaded addresses), and the portal User login (+ account
 * /sessions). Cleaners are NOT touched.
 */
import { db } from "@/db";
import { refuseOnMultiTenant } from "./_scope";

const EMAILS = ["premsaikilaru567@gmail.com", "20b91a12d9@gmail.com"];
const COMMIT = process.argv.includes("--commit");

async function main() {
  // Written when there was one company; its queries do not name one.
  await refuseOnMultiTenant(db as never, "clear-test-customers.ts");

  console.log(
    `\n${"=".repeat(64)}\nClear test-customer data — ${COMMIT ? "COMMIT (deleting)" : "DRY RUN (no writes)"}\n${"=".repeat(64)}`
  );

  for (const email of EMAILS) {
    const clients = await db.client.findMany({ where: { email } });
    const clientIds = clients.map((c) => c.id);
    const users = await db.user.findMany({ where: { email } });

    const jobCount = clientIds.length
      ? await db.job.count({ where: { clientId: { in: clientIds } } })
      : 0;
    const addrCount = clientIds.length
      ? await db.clientAddress.count({ where: { clientId: { in: clientIds } } })
      : 0;
    const contactCount = clientIds.length
      ? await db.contact.count({ where: { clientId: { in: clientIds } } })
      : 0;

    console.log(`\n• ${email}`);
    console.log(
      `    clients: ${clients.length} · jobs: ${jobCount} · addresses: ${addrCount} · contacts: ${contactCount} · user logins: ${users.length}`
    );

    if (!COMMIT) continue;

    // Delete in FK-safe order. Jobs first (Client.clientId on Job is SetNull, so
    // they would otherwise be left orphaned), then Contact (SetNull on client
    // delete), then Client (cascades addresses), then User (cascades acct/sessions).
    if (clientIds.length) {
      const j = await db.job.deleteMany({ where: { clientId: { in: clientIds } } });
      const ct = await db.contact.deleteMany({ where: { clientId: { in: clientIds } } });
      const a = await db.clientAddress.deleteMany({ where: { clientId: { in: clientIds } } });
      const c = await db.client.deleteMany({ where: { id: { in: clientIds } } });
      console.log(
        `    deleted → jobs ${j.count} · contacts ${ct.count} · addresses ${a.count} · clients ${c.count}`
      );
    }
    if (users.length) {
      const u = await db.user.deleteMany({ where: { email } });
      console.log(`    deleted → user logins ${u.count} (accounts + sessions cascaded)`);
    }
  }

  console.log(
    `\n${COMMIT ? "Done — data cleared. Re-run the import to load fresh." : "DRY RUN — nothing deleted. Re-run with --commit to delete."}\n`
  );
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
