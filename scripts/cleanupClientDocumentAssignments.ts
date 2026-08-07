/**
 * One-time cleanup: remove DocumentSignature rows that were created against
 * CLIENT-role users.
 *
 * Cause: "Assign to: all employees" resolved to `db.user.findMany()` with no
 * `where` clause in both createDocument.ts and assignDocument.ts. Imported
 * customers live in the same `user` table with role CLIENT, so "all employees"
 * meant "every account in the system" — a reported upload landed on 219 people,
 * a mix of clients and cleaners. The resolver now lives in
 * src/lib/document-assignees.ts and filters to staff roles; this script clears
 * the rows the old code already wrote.
 *
 *   npx tsx scripts/cleanupClientDocumentAssignments.ts           # dry-run
 *   npx tsx scripts/cleanupClientDocumentAssignments.ts --commit  # apply
 *
 * Clients were never able to open or sign these documents — /admin and
 * /cleaners both bounce CLIENT-role sessions — so every affected row should be
 * PENDING. If any row is not PENDING, that is unexpected: the script reports it
 * and leaves it alone unless you pass --include-signed.
 *
 * Re-running is safe; it is a no-op once the rows are gone.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const COMMIT = process.argv.includes("--commit");
const INCLUDE_SIGNED = process.argv.includes("--include-signed");

async function main() {
  const rows = await db.documentSignature.findMany({
    where: { employee: { role: "CLIENT" } },
    select: {
      id: true,
      status: true,
      signedAt: true,
      document: { select: { id: true, title: true } },
      employee: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (rows.length === 0) {
    console.log("No client-assigned document signatures found. Nothing to do.");
    return;
  }

  const pending = rows.filter((r) => r.status === "PENDING");
  const nonPending = rows.filter((r) => r.status !== "PENDING");

  // Per-document breakdown, so you can sanity-check against what the admin
  // actually saw in the Documents tab before deleting anything.
  const byDocument = new Map<string, { title: string; count: number }>();
  for (const r of rows) {
    const entry = byDocument.get(r.document.id) ?? {
      title: r.document.title,
      count: 0,
    };
    entry.count += 1;
    byDocument.set(r.document.id, entry);
  }

  console.log(
    `Found ${rows.length} document assignment(s) on CLIENT-role accounts ` +
      `(${pending.length} pending, ${nonPending.length} not pending).`
  );
  console.log("\nBy document:");
  for (const [id, { title, count }] of byDocument) {
    console.log(`  ${count.toString().padStart(4)}  ${title}  (${id})`);
  }

  console.log("\nSample of affected client accounts:");
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${r.employee.name} <${r.employee.email ?? "no email"}> — ` +
        `"${r.document.title}" [${r.status}]`
    );
  }
  if (rows.length > 10) console.log(`  … and ${rows.length - 10} more`);

  if (nonPending.length > 0) {
    console.log(
      `\n!! ${nonPending.length} row(s) are not PENDING — a client should not ` +
        `have been able to sign. Review these before deleting:`
    );
    for (const r of nonPending) {
      console.log(
        `  ${r.employee.name} — "${r.document.title}" [${r.status}] ` +
          `signedAt=${r.signedAt?.toISOString() ?? "null"}`
      );
    }
  }

  const targets = INCLUDE_SIGNED ? rows : pending;
  const skipped = rows.length - targets.length;

  if (!COMMIT) {
    console.log(
      `\nDry run. Would delete ${targets.length} row(s)` +
        (skipped > 0
          ? `, leaving ${skipped} non-PENDING row(s) in place (pass --include-signed to remove those too).`
          : ".")
    );
    console.log("Re-run with --commit to apply.");
    return;
  }

  const result = await db.documentSignature.deleteMany({
    where: { id: { in: targets.map((r) => r.id) } },
  });
  console.log(`\nDeleted ${result.count} row(s).`);
  if (skipped > 0) {
    console.log(
      `Left ${skipped} non-PENDING row(s) in place (pass --include-signed to remove those too).`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
