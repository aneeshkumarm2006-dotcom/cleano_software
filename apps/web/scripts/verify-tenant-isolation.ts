/** Adversarial check: can org A touch org B's rows through the scoped client? */
import { PrismaClient } from "@prisma/client";
import { scopedTo, CrossTenantError } from "../src/lib/db-scoped";
import { allocateJobNumber } from "../src/lib/job-number";
import { assertSafeTarget } from "../src/lib/safe-target";

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n: string) => { pass++; console.log(`  ok    ${n}`); };
const bad = (n: string, d: string) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };

async function expectRefused(name: string, fn: () => Promise<unknown>) {
  try { await fn(); bad(name, "the write was ALLOWED"); }
  catch (e) {
    if (e instanceof CrossTenantError) ok(name);
    else bad(name, `wrong error: ${(e as Error).message.slice(0, 60)}`);
  }
}

(async () => {
  assertSafeTarget(process.env.DATABASE_URL, "test");

  // Pick the organizations rather than naming them: the staging branch seeded
  // "-demo" slugs and a local database seeds the plain ones, and a script that
  // only runs in one of those places is a script nobody runs.
  //
  // Both must actually HAVE jobs and clients. An empty workspace passes every
  // check below for the wrong reason -- there is nothing there to leak -- and a
  // suite that cannot fail is worse than no suite.
  const candidates = await db.organization.findMany({
    where: { slug: { not: "platform" } },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true },
  });
  const withData: { id: string; slug: string }[] = [];
  for (const c of candidates) {
    const jobs = await db.job.count({ where: { organizationId: c.id } });
    const clients = await db.client.count({ where: { organizationId: c.id } });
    if (jobs > 0 && clients > 0) withData.push({ id: c.id, slug: c.slug });
  }
  if (withData.length < 2) {
    throw new Error(
      `need two seeded organizations WITH data; found ${withData.length}. Run scripts/seed-tenant.ts twice.`,
    );
  }
  const [A, B] = withData;
  console.log(`comparing "${A.slug}" against "${B.slug}"`);
  const dbA = scopedTo(db, A.id);

  // a row that definitively belongs to B
  const bJob = await db.job.findFirstOrThrow({ where: { organizationId: B.id } });
  const bClient = await db.client.findFirstOrThrow({ where: { organizationId: B.id } });

  console.log("\nREADS");
  const jobs = await dbA.job.findMany({ select: { organizationId: true } });
  jobs.every((j) => j.organizationId === A.id) && jobs.length > 0
    ? ok(`findMany returns only A's rows (${jobs.length})`)
    : bad("findMany", `leaked ${jobs.filter((j) => j.organizationId !== A.id).length}`);

  (await dbA.job.count()) === jobs.length ? ok("count is scoped") : bad("count", "unscoped");

  (await dbA.job.findUnique({ where: { id: bJob.id } })) === null
    ? ok("findUnique on B's job -> null")
    : bad("findUnique", "returned another tenant's row");

  (await dbA.job.findFirst({ where: { id: bJob.id } })) === null
    ? ok("findFirst on B's job -> null")
    : bad("findFirst", "returned another tenant's row");

  // Either error is acceptable, and "not found" is the better of the two: it
  // does not let a caller tell "this row does not exist" apart from "this row
  // belongs to someone else", which would disclose the existence of another
  // tenant's records. What must never happen is the row coming back.
  try {
    await dbA.job.findUniqueOrThrow({ where: { id: bJob.id } });
    bad("findUniqueOrThrow on B's job", "RETURNED another tenant's row");
  } catch {
    ok("findUniqueOrThrow on B's job -> throws, row withheld");
  }

  // Regression: a narrow select must not break the ownership check. Checking
  // row.organizationId after the fact reads undefined when the caller did not
  // select it, which silently rejected every lookup -- including better-auth's
  // session handler, which selects only `role`.
  const ownJob = await db.job.findFirstOrThrow({ where: { organizationId: A.id } });
  const narrow = await dbA.job.findUnique({
    where: { id: ownJob.id },
    select: { id: true, status: true },
  });
  narrow?.id === ownJob.id
    ? ok("findUnique with a narrow select still returns our own row")
    : bad("narrow select", "own row was rejected");

  (await dbA.job.findUnique({ where: { id: bJob.id }, select: { id: true } })) === null
    ? ok("findUnique with a narrow select still rejects B's row")
    : bad("narrow select", "returned another tenant's row");

  const narrowUser = await dbA.user.findUnique({
    where: { id: (await db.user.findFirstOrThrow({ where: { organizationId: A.id } })).id },
    select: { role: true },
  });
  narrowUser?.role
    ? ok(`user role reads through a role-only select (${narrowUser.role})`)
    : bad("session-shaped select", "role came back empty");

  console.log("\nWRITES");
  await expectRefused("update B's job", () =>
    dbA.job.update({ where: { id: bJob.id }, data: { notes: "pwned" } }));
  await expectRefused("delete B's client", () =>
    dbA.client.delete({ where: { id: bClient.id } }));
  await expectRefused("upsert onto B's job", () =>
    dbA.job.upsert({
      where: { id: bJob.id },
      update: { notes: "pwned" },
      create: { clientName: "x", startTime: new Date(), jobNumber: 999999 },
    }));

  // The marker has to be unique to THIS run. It used to be the constant
  // "bulk-a", which cannot tell a write made just now from one made by an
  // earlier run — and that is not hypothetical: on staging, teamcleano-demo
  // was company A once, kept all 40 of its jobs tagged "bulk-a", and then
  // reported a cross-tenant write leak every time it ran afterwards as
  // company B. A false alarm on the one assertion nobody can afford to
  // ignore is worse than no assertion at all.
  const bulkTag = `bulk-a-${Date.now().toString(36)}`;
  const bBefore = await db.job.count({ where: { organizationId: B.id } });
  await dbA.job.updateMany({ data: { notes: bulkTag } });
  const touchedB = await db.job.count({ where: { organizationId: B.id, notes: bulkTag } });
  touchedB === 0 ? ok("updateMany did not touch B") : bad("updateMany", `hit ${touchedB} of B's rows`);

  console.log("\nCREATE STAMPING");
  const made = await dbA.client.create({ data: { name: "Scoped Create Test" } });
  made.organizationId === A.id ? ok("create stamped with A") : bad("create", `got ${made.organizationId}`);
  await db.client.delete({ where: { id: made.id } });

  console.log("\nNESTED WRITES");
  // A parent write that creates children in the same statement: the children are
  // rows in a tenant table too, and go unclaimed unless stamped recursively.
  // That becomes a NOT NULL violation on real features -- booking photos,
  // invoice line items, checklist items.
  const parent = await dbA.job.create({
    data: {
      jobNumber: await allocateJobNumber(A.id),
      clientName: "Nested Write Probe",
      startTime: new Date(),
      addOns: { create: [{ name: "Oven", price: 30 }, { name: "Fridge", price: 25 }] },
    },
    include: { addOns: true },
  });
  const kids = parent.addOns ?? [];
  kids.length === 2 && kids.every((k) => k.organizationId === A.id)
    ? ok(`children created by a nested write inherit the organization (${kids.length})`)
    : bad("nested create", `${kids.filter((k) => k.organizationId !== A.id).length} unclaimed child rows`);

  // and the same through an update
  const viaUpdate = await dbA.job.update({
    where: { id: parent.id },
    data: { addOns: { create: [{ name: "Windows", price: 40 }] } },
    include: { addOns: true },
  });
  (viaUpdate.addOns ?? []).every((k) => k.organizationId === A.id)
    ? ok("children created by a nested update inherit it too")
    : bad("nested update", "unclaimed child row");

  await db.jobAddOn.deleteMany({ where: { jobId: parent.id } });
  await db.job.delete({ where: { id: parent.id } });

  console.log("\nCOMPOUND UNIQUE KEYS");
  // Thirty-one models are addressed by a two-part key -- a cleaner's
  // availability by employee and day, a job by organization and number, an
  // invoice by its number. Every write through such a key used to die: the
  // ownership check re-issued the caller's `where` as a findFirst, and Prisma
  // rejects `{ employeeId_day: {...} }` there outright. Reads had their own
  // path and were fine, which is why it stayed hidden -- pages loaded; only
  // pressing a button failed.
  const aEmp = await db.user.findFirstOrThrow({
    where: { organizationId: A.id, role: "EMPLOYEE" },
  });
  const bEmp = await db.user.findFirstOrThrow({
    where: { organizationId: B.id, role: "EMPLOYEE" },
  });
  const DAY = "SUNDAY" as const;

  await db.employeeAvailability.deleteMany({ where: { employeeId: { in: [aEmp.id, bEmp.id] }, day: DAY } });

  // upsert through the compound key, on our own employee
  const madeUp = await dbA.employeeAvailability.upsert({
    where: { employeeId_day: { employeeId: aEmp.id, day: DAY } },
    create: { employeeId: aEmp.id, day: DAY, startTime: "09:00", endTime: "17:00" },
    update: { endTime: "18:00" },
  });
  madeUp.organizationId === A.id
    ? ok("upsert through a two-part key creates, stamped with our organization")
    : bad("compound upsert", `stamped ${madeUp.organizationId}`);

  // and again, so it takes the update branch rather than the create branch
  const again = await dbA.employeeAvailability.upsert({
    where: { employeeId_day: { employeeId: aEmp.id, day: DAY } },
    create: { employeeId: aEmp.id, day: DAY, startTime: "09:00", endTime: "17:00" },
    update: { endTime: "18:00" },
  });
  again.endTime === "18:00"
    ? ok("upsert through a two-part key updates the row it already made")
    : bad("compound upsert update branch", again.endTime);

  const updated = await dbA.employeeAvailability.update({
    where: { employeeId_day: { employeeId: aEmp.id, day: DAY } },
    data: { startTime: "08:00" },
  });
  updated.startTime === "08:00"
    ? ok("update through a two-part key changes our own row")
    : bad("compound update", updated.startTime);

  // the same key, pointed at the other company
  await db.employeeAvailability.create({
    data: { organizationId: B.id, employeeId: bEmp.id, day: DAY, startTime: "09:00", endTime: "17:00" },
  });
  await expectRefused("update B's row through a two-part key", () =>
    dbA.employeeAvailability.update({
      where: { employeeId_day: { employeeId: bEmp.id, day: DAY } },
      data: { startTime: "23:00" },
    }));
  await expectRefused("delete B's row through a two-part key", () =>
    dbA.employeeAvailability.delete({
      where: { employeeId_day: { employeeId: bEmp.id, day: DAY } },
    }));
  await expectRefused("upsert onto B's row through a two-part key", () =>
    dbA.employeeAvailability.upsert({
      where: { employeeId_day: { employeeId: bEmp.id, day: DAY } },
      create: { employeeId: bEmp.id, day: DAY, startTime: "01:00", endTime: "02:00" },
      update: { startTime: "01:00" },
    }));

  const bRow = await db.employeeAvailability.findFirstOrThrow({
    where: { employeeId: bEmp.id, day: DAY },
  });
  bRow.startTime === "09:00"
    ? ok("B's row is exactly as it was")
    : bad("B's row was modified", bRow.startTime);

  await db.employeeAvailability.deleteMany({ where: { employeeId: { in: [aEmp.id, bEmp.id] }, day: DAY } });

  console.log("\nCOLLATERAL DAMAGE CHECK");
  const bAfter = await db.job.count({ where: { organizationId: B.id } });
  bAfter === bBefore ? ok(`B's job count unchanged (${bAfter})`) : bad("B row count", `${bBefore} -> ${bAfter}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
