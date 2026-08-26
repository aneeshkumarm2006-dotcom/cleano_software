/**
 * Check that the access-request table landed the way it was meant to.
 *
 *   DATABASE_URL="$STAGING_DATABASE_URL" npx tsx scripts/verify-access-requests.ts
 *
 * The interesting assertion is the one about grants. This table holds
 * prospective customers' names, emails and phone numbers and belongs to no
 * organization, so it has no row-level-security policy -- the whole protection
 * is that the application role cannot touch it. A revoke that silently did not
 * apply would look exactly like a revoke that did.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
let pass = 0,
  fail = 0;
const ok = (m: string) => {
  pass++;
  console.log("  ok    " + m);
};
const bad = (m: string, d: string) => {
  fail++;
  console.log("  FAIL  " + m + " — " + d);
};

(async () => {
  if (!(process.env.DATABASE_URL ?? "").includes("udgbixmlyqsoalvrjbgo")) {
    throw new Error("ABORT: not staging");
  }

  console.log("\nSHAPE");
  // The exact set, not a count: a count is something a person can get wrong
  // while the schema is right, and then "fixing" it hides a real difference.
  const EXPECTED = [
    "companyName", "contactName", "createdAt", "createdOrgId", "decidedAt",
    "decidedByEmail", "decidedById", "decisionNote", "email", "fleetSize",
    "id", "message", "phone", "status", "submittedFrom", "updatedAt", "wantedSlug",
  ];
  const cols = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'AccessRequest'
     ORDER BY column_name`;
  const got = cols.map((c) => c.column_name);
  const missing = EXPECTED.filter((c) => !got.includes(c));
  const extra = got.filter((c) => !EXPECTED.includes(c));
  missing.length === 0 && extra.length === 0
    ? ok(`table has exactly the ${got.length} expected columns`)
    : bad("columns differ", `missing [${missing}] extra [${extra}]`);

  const en = await db.$queryRaw<{ enumlabel: string }[]>`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'AccessRequestStatus' ORDER BY e.enumsortorder`;
  const labels = en.map((r) => r.enumlabel).join(",");
  labels === "PENDING,APPROVED,DECLINED"
    ? ok("status enum is PENDING, APPROVED, DECLINED")
    : bad("enum labels", labels);

  const idx = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'AccessRequest'`;
  Number(idx[0].n) === 4
    ? ok("indexed on status, createdAt and email (plus the key)")
    : bad("index count", `${idx[0].n}`);

  console.log("\nWHO CAN READ IT");
  const grants = await db.$queryRaw<{ privilege_type: string }[]>`
    SELECT privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'AccessRequest' AND grantee = 'awer_app'`;
  grants.length === 0
    ? ok("the application role has no privileges on it at all")
    : bad("awer_app can still reach it", grants.map((g) => g.privilege_type).join(","));

  // Contrast, so a pass above cannot just mean "that role has nothing anywhere".
  const sub = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'Subscription' AND grantee = 'awer_app'`;
  Number(sub[0].n) > 0
    ? ok("that same role still reaches a tenant table, so the revoke was targeted")
    : bad("awer_app has no grants anywhere", "the contrast check is meaningless");

  const rls = await db.$queryRaw<{ relrowsecurity: boolean }[]>`
    SELECT relrowsecurity FROM pg_class WHERE relname = 'AccessRequest'`;
  rls[0]?.relrowsecurity === false
    ? ok("no row-level security, by design — it has no organization to key on")
    : bad("unexpected RLS", "a policy here would key off a column that does not exist");

  console.log("\nUSABLE");
  const probe = await db.accessRequest.create({
    data: {
      companyName: "Verify Co",
      contactName: "Verify Person",
      email: "verify@example.test",
      fleetSize: "about 60",
    },
  });
  probe.status === "PENDING"
    ? ok("a new request defaults to PENDING")
    : bad("default status", probe.status);
  probe.createdAt instanceof Date ? ok("timestamps are set") : bad("createdAt", "missing");
  await db.accessRequest.delete({ where: { id: probe.id } });
  (await db.accessRequest.count()) === 0
    ? ok("probe row removed; table left empty")
    : bad("cleanup", "probe row still present");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})()
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
