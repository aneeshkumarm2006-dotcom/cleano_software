/**
 * Two throwaway companies for the API v1 integration tests, and their removal.
 *
 * Everything here is synthetic: `.test` emails that can never resolve, no
 * phone numbers, made-up addresses. It is created at the start of a run and
 * deleted at the end, and never touches any other company's rows.
 *
 * Refuses anything but a staging or local database (lib/safe-target.ts), and
 * refuses a plain "local" unless asked, because the point is the real schema.
 */
import { PrismaClient, type Roles } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import { describeTarget } from "../../src/lib/safe-target";

// V1_FIXTURE_SUFFIX (lowercase letters) keeps parallel runs against the same
// staging database out of each other's companies.
const SUFFIX = /^[a-z]{1,12}$/.test(process.env.V1_FIXTURE_SUFFIX ?? "") ? `-${process.env.V1_FIXTURE_SUFFIX}` : "";
export const SLUG_A = `v1test-alpha${SUFFIX}`;
export const SLUG_B = `v1test-bravo${SUFFIX}`;
export const PASSWORD = "V1-Test-Pass-2026!";

export interface Fixture {
  orgA: { id: string; slug: string };
  orgB: { id: string; slug: string };
  users: Record<
    "cleaner" | "teammate" | "inactive" | "client" | "applicant" | "mustChange" | "owner" | "bCleaner",
    { id: string; email: string }
  >;
  jobs: {
    /** Cleaner's, starting in an hour: clockable. */
    mine: string;
    /** Cleaner's, tomorrow: for lists. */
    mineTomorrow: string;
    /** Only the teammate's, same company. */
    teammates: string;
    /** In company B. */
    otherCompany: string;
    /** Cleaner's, started half an hour ago: the offline rules. */
    offline: string;
    /** Cleaner's, started an hour ago: the too-late rule. */
    late: string;
  };
  checklistItem: string;
  otherChecklistItem: string;
}

export function openDb(): PrismaClient {
  const url = process.env.FIXTURE_DATABASE_URL;
  const t = describeTarget(url);
  if (!t.ok || (t.label !== "staging" && process.env.V1_ALLOW_LOCAL !== "1")) {
    throw new Error(`refusing fixture database: ${t.reason ?? t.label}`);
  }
  console.log(`fixture database: ${t.label}`);
  const base = new PrismaClient({ datasources: { db: { url } } });
  // Staging's pooler drops connections now and then (MULTI_TENANT.md, "Known
  // wrinkles"). A connection-level failure is retried; anything else is not.
  const RETRYABLE = new Set(["P1001", "P1002", "P1017", "P2024"]);
  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        for (let attempt = 1; ; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            const code = (e as { code?: string }).code;
            if (!code || !RETRYABLE.has(code) || attempt >= 5) throw e;
            await new Promise((r) => setTimeout(r, 2_000 * attempt));
          }
        }
      },
    },
  }) as unknown as PrismaClient;
}

/** Delete every row the two test companies own, then the companies. */
export async function removeFixture(db: PrismaClient): Promise<void> {
  const orgs = await db.organization.findMany({
    where: { slug: { in: [SLUG_A, SLUG_B] } },
    select: { id: true },
  });
  const ids = orgs.map((o) => o.id);
  if (ids.length === 0) return;

  const users = await db.user.findMany({ where: { organizationId: { in: ids } }, select: { id: true } });
  const userIds = users.map((u) => u.id);

  // Not tenant tables: better-auth's own, keyed by user.
  if (userIds.length) {
    await db.session.deleteMany({ where: { userId: { in: userIds } } });
    await db.account.deleteMany({ where: { userId: { in: userIds } } });
    await db.verification.deleteMany({ where: { value: { in: userIds } } });
  }

  // Every tenant table, in as many passes as foreign keys need.
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId'
      AND table_name NOT IN ('Organization', 'User')`;
  let pending = tables.map((t) => t.table_name);
  for (let pass = 0; pass < 8 && pending.length > 0; pass++) {
    const failed: string[] = [];
    for (const table of pending) {
      try {
        await db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = ANY($1::text[])`, ids);
      } catch {
        failed.push(table);
      }
    }
    pending = failed;
  }
  if (pending.length) throw new Error(`could not clear: ${pending.join(", ")}`);
  await db.user.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
}

export async function createFixture(db: PrismaClient): Promise<Fixture> {
  await removeFixture(db);
  const hashed = await hashPassword(PASSWORD);

  const org = (slug: string) =>
    db.organization.create({
      data: { slug, name: `V1 Test ${slug.split("-")[1]}`, status: "ACTIVE", plan: "PROFESSIONAL", timezone: "America/Toronto" },
      select: { id: true, slug: true },
    });
  const orgA = await org(SLUG_A);
  const orgB = await org(SLUG_B);

  async function user(
    organizationId: string,
    slug: string,
    local: string,
    role: Roles,
    extra: { isActive?: boolean; mustChangePassword?: boolean } = {},
  ) {
    const email = `${local}@${slug}.test`;
    const u = await db.user.create({
      data: {
        organizationId,
        name: `${local[0].toUpperCase()}${local.slice(1)} Tester`,
        email,
        role,
        emailVerified: true,
        isActive: extra.isActive ?? true,
        mustChangePassword: extra.mustChangePassword ?? false,
      },
      select: { id: true, email: true },
    });
    await db.account.create({
      data: { userId: u.id, accountId: u.id, providerId: "credential", password: hashed },
    });
    return u;
  }

  const users = {
    cleaner: await user(orgA.id, SLUG_A, "cleaner", "EMPLOYEE"),
    teammate: await user(orgA.id, SLUG_A, "teammate", "EMPLOYEE"),
    inactive: await user(orgA.id, SLUG_A, "inactive", "EMPLOYEE"),
    client: await user(orgA.id, SLUG_A, "client", "CLIENT"),
    applicant: await user(orgA.id, SLUG_A, "applicant", "APPLICANT"),
    mustChange: await user(orgA.id, SLUG_A, "mustchange", "EMPLOYEE", { mustChangePassword: true }),
    owner: await user(orgA.id, SLUG_A, "owner", "OWNER"),
    bCleaner: await user(orgB.id, SLUG_B, "cleaner", "EMPLOYEE"),
  };

  const now = Date.now();
  let n = 9000;
  async function job(organizationId: string, cleanerId: string, startMs: number, label: string) {
    const start = new Date(startMs);
    const j = await db.job.create({
      data: {
        organizationId,
        jobNumber: n++,
        clientName: `Prem Sai ${label}`,
        employeeId: cleanerId,
        jobType: "Standard Clean",
        location: `${n} Test Street`,
        startTime: start,
        endTime: new Date(start.getTime() + 3 * 3600_000),
        jobDate: start,
        status: "SCHEDULED",
        price: 120,
        subtotalAmount: 120,
        requiredCleaners: 1,
        notes: "Park on the street. Total $120 billed to card.",
        cleaners: { connect: [{ id: cleanerId }] },
      },
      select: { id: true },
    });
    await db.jobAssignment.create({ data: { organizationId, jobId: j.id, cleanerId } });
    return j.id;
  }

  const jobs = {
    mine: await job(orgA.id, users.cleaner.id, now + 60 * 60_000, "A"),
    mineTomorrow: await job(orgA.id, users.cleaner.id, now + 26 * 3600_000, "B"),
    teammates: await job(orgA.id, users.teammate.id, now + 60 * 60_000, "C"),
    otherCompany: await job(orgB.id, users.bCleaner.id, now + 60 * 60_000, "D"),
    offline: await job(orgA.id, users.cleaner.id, now - 30 * 60_000, "E"),
    late: await job(orgA.id, users.cleaner.id, now - 60 * 60_000, "F"),
  };

  // A checklist on the cleaner's job, and one on the teammate's.
  async function checklist(organizationId: string, jobId: string, employeeId: string) {
    const c = await db.jobChecklist.create({
      data: {
        organizationId,
        jobId,
        employeeId,
        items: {
          create: [
            { organizationId, title: "Kitchen counters", sortOrder: 1, isRequired: true },
            { organizationId, title: "Bathroom mirror", sortOrder: 2, isRequired: false },
          ],
        },
      },
      select: { items: { select: { id: true }, orderBy: { sortOrder: "asc" } } },
    });
    return c.items[0].id;
  }
  // The web rebuilds a job's checklist from the company's templates when a
  // cleaner opens it (ensureJobChecklist), so the cleaner's job is pinned to a
  // template here, exactly as an admin would pin one.
  const template = await db.checklistTemplate.create({
    data: {
      organizationId: orgA.id,
      name: "V1 test clean",
      items: {
        create: [
          { organizationId: orgA.id, title: "Kitchen counters", sortOrder: 1, isRequired: true },
          { organizationId: orgA.id, title: "Bathroom mirror", sortOrder: 2, isRequired: false },
        ],
      },
    },
    select: { id: true },
  });
  await db.job.update({ where: { id: jobs.mine }, data: { checklistTemplateId: template.id } });
  const checklistItem = await checklist(orgA.id, jobs.mine, users.cleaner.id);
  const otherChecklistItem = await checklist(orgA.id, jobs.teammates, users.teammate.id);

  return { orgA, orgB, users, jobs, checklistItem, otherChecklistItem };
}
