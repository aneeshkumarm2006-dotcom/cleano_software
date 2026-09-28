/**
 * The "Bookmops Demo" workspace that Apple's App Review signs in to.
 *
 *   DEMO_DATABASE_URL=... npx tsx scripts/demo-company.ts --target staging --dry-run
 *   DEMO_DATABASE_URL=... npx tsx scripts/demo-company.ts --target staging --apply [--credentials-file <path>]
 *   DEMO_DATABASE_URL=... npx tsx scripts/demo-company.ts --target staging --verify
 *   DEMO_DATABASE_URL=... npx tsx scripts/demo-company.ts --target staging --teardown
 *
 * Production additionally needs `--target production --confirm-production
 * kbreldosgjzwqnwnvxgw`, typed out, because every other script in this folder
 * refuses production outright (lib/safe-target.ts) and this one is the single,
 * owner-approved exception. It writes ONLY rows whose organizationId is the demo
 * workspace's, and reads other companies only to answer two yes/no questions:
 * is the slug free, and does any demo email already sign in somewhere else.
 *
 * What it builds (all invented; nothing here can reach a real person):
 *   - organization `demo` ("Bookmops Demo"), America/Toronto, CAD, ACTIVE, with
 *     an ACTIVE subscription and no Stripe ids, so nothing bills and no trial
 *     cron ever marks it PAST_DUE; no SMS number, no Stripe, no Twilio;
 *   - staff at @example.com (RFC 2606: never delivers), no phone numbers;
 *   - every EMAIL and SMS notification switched off in the workspace's own
 *     notification settings, every job with notifyClient off, AI assistant off;
 *   - clients with 555-01xx phones and "Example St" addresses;
 *   - 21 days of work for the review account, an open-jobs board, pay history
 *     with a withdrawable balance, chat, an announcement, kit, training, a
 *     document to sign, availability, and two approvals for the manager side.
 *
 * Idempotent:
 *   - --apply on a missing workspace creates it and prints the new password
 *     ONCE (and writes it to --credentials-file, mode 600).
 *   - --apply on an existing demo workspace REFRESHES it: the people, their
 *     passwords, their sessions and push devices are kept; everything else the
 *     workspace owns is cleared and rebuilt with dates from today. Re-run it to
 *     extend the 21-day window. `--reset-password` rotates the password too.
 *   - --teardown deletes the workspace and every row under it.
 *
 * The demo workspace is recognised by slug AND name AND a marker setting, so a
 * real company that one day owns the slug can never be refreshed or deleted.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";

import { computeJobPayout, fallbackRateInput, summarisePayouts } from "@bookmops/core/pay";
import { PrismaClient, type Prisma, type Roles } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import { claimableJobsWhere, cleanerAssignedWhere } from "../src/lib/cleaner-jobs";
import { NOTIFICATION_CATALOG } from "../src/lib/notifications/catalog";
import { RESERVING_WITHDRAWAL_STATUSES, reservedCentsOf, toCents } from "../src/lib/withdrawal-rules";

// ── Constants ────────────────────────────────────────────────────────────────

const SLUG = "demo";
const NAME = "Bookmops Demo";
const TZ = "America/Toronto";
const MARKER_KEY = "demo.appReviewWorkspace";
const DAYS_AHEAD = 21;

const REFS = { staging: "udgbixmlyqsoalvrjbgo", production: "kbreldosgjzwqnwnvxgw" } as const;
type Target = keyof typeof REFS;

type PersonKey = "alex" | "lead" | "manager" | "owner" | "maya" | "jordan" | "sam";
const PEOPLE: Record<PersonKey, { email: string; name: string; role: Roles }> = {
  alex: { email: "appreview@example.com", name: "Alex Reviewer", role: "EMPLOYEE" },
  lead: { email: "lead@example.com", name: "Taylor Brooks", role: "FIELD_LEAD" },
  manager: { email: "manager@example.com", name: "Morgan Lee", role: "OPS_MANAGER" },
  owner: { email: "owner@example.com", name: "Riley Carter", role: "ADMIN" },
  maya: { email: "maya.chen@example.com", name: "Maya Chen", role: "EMPLOYEE" },
  jordan: { email: "jordan.patel@example.com", name: "Jordan Patel", role: "EMPLOYEE" },
  sam: { email: "sam.rivera@example.com", name: "Sam Rivera", role: "EMPLOYEE" },
};
const ALL_EMAILS = Object.values(PEOPLE).map((p) => p.email);

const CLIENTS = [
  { name: "Olivia Martin", email: "olivia.martin@example.com", phone: "+14165550101", address: "100 Example St", city: "Toronto", postal: "M5V 1A1", type: "APARTMENT_CONDO", beds: 2, baths: 1 },
  { name: "Ethan Walker", email: "ethan.walker@example.com", phone: "+14165550102", address: "22 Sample Ave", city: "North York", postal: "M2N 1A1", type: "HOUSE", beds: 3, baths: 2 },
  { name: "Sophie Tremblay", email: "sophie.tremblay@example.com", phone: "+14165550103", address: "7 Demo Crescent", city: "Etobicoke", postal: "M9A 1A1", type: "HOUSE", beds: 4, baths: 3 },
  { name: "Daniel Nguyen", email: "daniel.nguyen@example.com", phone: "+14165550104", address: "350 Placeholder Rd", city: "Scarborough", postal: "M1P 1A1", type: "APARTMENT_CONDO", beds: 1, baths: 1 },
  { name: "Priya Shah", email: "priya.shah@example.com", phone: "+14165550105", address: "48 Test Lane", city: "Toronto", postal: "M4M 1A1", type: "HOUSE", beds: 3, baths: 2 },
] as const;

const SETTINGS: { key: string; category: string; value: Prisma.InputJsonValue }[] = [
  { key: "general.businessName", category: "general", value: NAME },
  { key: "general.businessEmail", category: "general", value: "office@example.com" },
  { key: "general.businessPhone", category: "general", value: "(416) 555-0100" },
  { key: "general.timezone", category: "general", value: TZ },
  { key: "general.currency", category: "general", value: "CAD" },
  // The registry default is already off; written anyway so it is stated, not assumed.
  {
    key: "ai.assistant",
    category: "ai",
    value: { enabled: false, smsReplies: false, emailReplies: false, businessFacts: "", dailyMessageCap: 0, followUpSequenceDays: [] },
  },
  // "On my way" shares location, so the phone asks for the permission.
  { key: "tracking.gpsEnabled", category: "scheduling", value: true },
  { key: "customer.smsOptInDefault", category: "customer", value: false },
  { key: MARKER_KEY, category: "demo", value: true },
];

/** Rows a refresh keeps: the workspace, its people, and what their phones hold. */
const KEEP_ON_REFRESH = new Set([
  "Organization",
  "User",
  "Subscription",
  "AppSetting",
  "NotificationSetting",
  "PushDevice",
  "PushThrottle",
  "UserRequestActivity",
  "IdempotencyRecord",
  "AccountDeletionRequest",
  "RateLimitCounter",
]);

// ── Arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const val = (f: string) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

type Mode = "dry-run" | "apply" | "teardown" | "verify";
function parseMode(): Mode {
  const modes = (["dry-run", "apply", "teardown", "verify"] as const).filter(has);
  if (modes.length > 1) throw new Error("pick one of --dry-run, --apply, --teardown, --verify");
  return modes[0] ?? "dry-run";
}

function openTarget(): { db: PrismaClient; target: Target } {
  const target = val("target") as Target | undefined;
  if (target !== "staging" && target !== "production") {
    throw new Error("--target staging|production is required");
  }
  const url = (process.env.DEMO_DATABASE_URL ?? "").trim();
  if (!url) throw new Error("DEMO_DATABASE_URL is not set");
  // The URL must name the project the flag names, and only that one.
  const ref = REFS[target];
  const other = REFS[target === "staging" ? "production" : "staging"];
  if (!url.includes(ref) || url.includes(other)) {
    throw new Error(`DEMO_DATABASE_URL does not point at ${target} (${ref})`);
  }
  if (target === "production" && val("confirm-production") !== REFS.production) {
    throw new Error(`production needs --confirm-production ${REFS.production}`);
  }
  console.log(`target: ${target} (project ref ${ref})`);
  // A small pool: Supabase's session pooler caps clients per project, and the
  // live app shares that cap.
  const pooled = url.includes("connection_limit=") ? url : `${url}${url.includes("?") ? "&" : "?"}connection_limit=2`;
  const base = new PrismaClient({ datasources: { db: { url: pooled } } });
  // The pooler drops connections now and then; retry those, nothing else.
  const RETRYABLE = new Set(["P1001", "P1002", "P1017", "P2024"]);
  const db = base.$extends({
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
  return { db, target };
}

// ── Company-time helpers (America/Toronto, DST-safe) ─────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

function dateKeyIn(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday, of the calendar date itself. */
function weekday(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Offset (ms) of TZ from UTC at an instant. */
function offsetAt(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - instant;
}

/** Wall-clock time in the company's zone → the instant. */
function at(key: string, hh: number, mm = 0, ss = 0, ms = 0): Date {
  const [y, m, d] = key.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  return new Date(t);
}

const minutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);

// ── Checks ───────────────────────────────────────────────────────────────────

interface DemoOrg {
  id: string;
}

/** The demo workspace if it exists and is ours; throws if the slug is someone else's. */
async function findDemoOrg(db: PrismaClient): Promise<DemoOrg | null> {
  const org = await db.organization.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!org) return null;
  const marker = await db.appSetting.findFirst({
    where: { organizationId: org.id, key: MARKER_KEY },
    select: { value: true },
  });
  if (org.name !== NAME || marker?.value !== true) {
    throw new Error(`STOP: the slug "${SLUG}" is taken by a workspace this script did not create. Nothing was changed.`);
  }
  return { id: org.id };
}

/**
 * Do any demo emails already exist in ANOTHER workspace? Workspace discovery
 * spans companies, so the review account must be unique to this one.
 * Returns the emails found; never reads anything but their existence.
 */
async function emailsElsewhere(db: PrismaClient, demoId: string | null): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { email: { in: ALL_EMAILS }, ...(demoId ? { organizationId: { not: demoId } } : {}) },
    select: { email: true },
  });
  return [...new Set(rows.map((r) => r.email))];
}

// ── Deleting ─────────────────────────────────────────────────────────────────

/** Every public table carrying organizationId, minus the ones named in `keep`. */
async function clearOrgTables(db: PrismaClient, orgId: string, keep: Set<string>): Promise<void> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId'`;
  let pending = tables.map((t) => t.table_name).filter((t) => !keep.has(t));
  for (let pass = 0; pass < 10 && pending.length > 0; pass++) {
    const failed: string[] = [];
    for (const table of pending) {
      try {
        // Table names come from information_schema, never from input; the
        // organization id is a bound parameter.
        await db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, orgId);
      } catch {
        failed.push(table);
      }
    }
    pending = failed;
  }
  if (pending.length) throw new Error(`could not clear: ${pending.join(", ")}`);
}

async function teardown(db: PrismaClient, org: DemoOrg): Promise<void> {
  const users = await db.user.findMany({ where: { organizationId: org.id }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  if (userIds.length) {
    // better-auth's own tables, keyed by user rather than organization.
    await db.session.deleteMany({ where: { userId: { in: userIds } } });
    await db.account.deleteMany({ where: { userId: { in: userIds } } });
    await db.verification.deleteMany({ where: { value: { in: userIds } } });
  }
  await clearOrgTables(db, org.id, new Set(["Organization", "User"]));
  await db.user.deleteMany({ where: { organizationId: org.id } });
  await db.organization.delete({ where: { id: org.id } });
}

// ── Creating ─────────────────────────────────────────────────────────────────

function strongPassword(): string {
  // 18 random bytes → 24 base64url characters, plus a fixed-class suffix so any
  // "needs a digit and a symbol" rule is met regardless of the random part.
  return `${randomBytes(18).toString("base64url")}-9a`;
}

async function createWorkspace(db: PrismaClient, password: string): Promise<{ orgId: string; ids: Record<PersonKey, string> }> {
  const hashed = await hashPassword(password);
  // One transaction, as provisionOrganization() does, so a half-made workspace
  // cannot exist. provisionOrganization() itself is not called: "demo" is a
  // reserved slug (lib/tenant.ts) precisely so no customer can claim it, and
  // it would make the owner an unverified OWNER with a TRIALING subscription.
  return db.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: { slug: SLUG, name: NAME, status: "ACTIVE", plan: "PROFESSIONAL", timezone: TZ },
        select: { id: true },
      });
      // ACTIVE with no Stripe ids: the trial cron only looks at TRIALING rows,
      // and nothing gates access on subscription status. Seeded like
      // scripts/seed-tenant.ts, with a long period end.
      const periodEnd = new Date();
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      await tx.subscription.create({
        data: { organizationId: org.id, plan: "PROFESSIONAL", status: "ACTIVE", currentPeriodEnd: periodEnd },
      });
      const ids = {} as Record<PersonKey, string>;
      for (const [key, p] of Object.entries(PEOPLE) as [PersonKey, (typeof PEOPLE)[PersonKey]][]) {
        const u = await tx.user.create({
          data: {
            organizationId: org.id,
            name: p.name,
            email: p.email,
            role: p.role,
            emailVerified: true,
            isActive: true,
            mustChangePassword: false,
            // The review account has already seen the web's guided tour.
            tourSeenAt: new Date(),
          },
          select: { id: true },
        });
        await tx.account.create({
          data: { userId: u.id, accountId: u.id, providerId: "credential", password: hashed },
        });
        ids[key] = u.id;
      }
      await tx.appSetting.create({ data: { organizationId: org.id, key: MARKER_KEY, category: "demo", value: true } });
      return { orgId: org.id, ids };
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
}

async function peopleOf(db: PrismaClient, orgId: string): Promise<Record<PersonKey, string>> {
  const rows = await db.user.findMany({
    where: { organizationId: orgId, email: { in: ALL_EMAILS } },
    select: { id: true, email: true },
  });
  const ids = {} as Record<PersonKey, string>;
  for (const [key, p] of Object.entries(PEOPLE) as [PersonKey, (typeof PEOPLE)[PersonKey]][]) {
    const row = rows.find((r) => r.email === p.email);
    if (!row) throw new Error(`${p.email} is missing from the demo workspace; run --teardown then --apply`);
    ids[key] = row.id;
  }
  return ids;
}

async function upsertSettings(db: PrismaClient, orgId: string): Promise<void> {
  for (const s of SETTINGS) {
    await db.appSetting.upsert({
      where: { organizationId_key: { organizationId: orgId, key: s.key } },
      create: { organizationId: orgId, key: s.key, category: s.category, value: s.value },
      update: { category: s.category, value: s.value },
    });
  }
  // The workspace's own notification settings, one row per catalog entry and
  // channel (as seedNotificationCatalog writes them), with every EMAIL and SMS
  // off. APP_PUSH keeps the catalog default: it reaches only the review phone.
  for (const [idx, entry] of NOTIFICATION_CATALOG.entries()) {
    for (const [channel, dflt] of Object.entries(entry.channels) as ["EMAIL" | "SMS" | "APP_PUSH", boolean][]) {
      const enabled = channel === "APP_PUSH" ? !!dflt : false;
      await db.notificationSetting.upsert({
        where: {
          organizationId_recipient_key_channel: { organizationId: orgId, recipient: entry.recipient, key: entry.key, channel },
        },
        create: {
          organizationId: orgId, recipient: entry.recipient, category: entry.category, key: entry.key,
          label: entry.label, trigger: entry.trigger, channel, enabled, isProposed: entry.isProposed ?? false, sortOrder: idx,
        },
        update: { enabled },
      });
    }
  }
}

interface SeedCounts {
  clients: number;
  jobs: { alexUpcoming: number; othersUpcoming: number; open: number; pastCompleted: number };
  [k: string]: unknown;
}

async function seedData(db: PrismaClient, orgId: string, ids: Record<PersonKey, string>, now: Date): Promise<SeedCounts> {
  const o = { organizationId: orgId };
  const today = dateKeyIn(now);

  // People: the crew reports to the field lead (so the lead's approvals list
  // has someone in it), availability, clean flags.
  await db.user.updateMany({
    where: { organizationId: orgId },
    data: { isActive: true, deletedAt: null, mustChangePassword: false, chatDisabledAt: null, phone: null },
  });
  await db.user.updateMany({
    where: { organizationId: orgId, id: { in: [ids.alex, ids.maya, ids.jordan, ids.sam] } },
    data: { fieldLeadId: ids.lead },
  });
  for (const day of ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const) {
    await db.employeeAvailability.create({
      data: { ...o, employeeId: ids.alex, day, startTime: "08:00", endTime: "17:00", isAvailable: true, isRecurring: true },
    });
  }

  // Clients and their service addresses.
  const clients: { id: string; addressId: string; c: (typeof CLIENTS)[number] }[] = [];
  for (const c of CLIENTS) {
    const client = await db.client.create({
      data: {
        ...o, name: c.name, email: c.email, phone: c.phone, address: c.address, city: c.city,
        state: "ON", zip: c.postal, clientType: "RESIDENTIAL",
        notes: "Demo client. Made-up details.",
      },
      select: { id: true },
    });
    const addr = await db.clientAddress.create({
      data: {
        ...o, clientId: client.id, label: "Home", address: c.address, city: c.city, postalCode: c.postal,
        propertyType: c.type, bedCount: c.beds, bathCount: c.baths, isDefault: true,
        accessNotes: "Demo: ring the buzzer, the client will let you in.",
      },
      select: { id: true },
    });
    clients.push({ id: client.id, addressId: addr.id, c });
  }

  // One checklist, pinned to every job so the app builds it when a job opens.
  const template = await db.checklistTemplate.create({
    data: {
      ...o, name: "Standard clean", jobType: "Standard Clean", description: "The usual visit, top to bottom.",
      items: {
        create: [
          { ...o, title: "Kitchen counters and sink", sortOrder: 1, isRequired: true },
          { ...o, title: "Wipe appliance fronts", sortOrder: 2, isRequired: true },
          { ...o, title: "Bathroom: sink, mirror, toilet, tub", sortOrder: 3, isRequired: true },
          { ...o, title: "Dust reachable surfaces", sortOrder: 4, isRequired: false },
          { ...o, title: "Vacuum and mop floors", sortOrder: 5, isRequired: true },
          { ...o, title: "Empty bins and replace liners", sortOrder: 6, isRequired: false },
        ],
      },
    },
    select: { id: true },
  });

  let jobNumber = 1001;
  let clientTurn = 0;
  const nextClient = () => clients[clientTurn++ % clients.length];

  interface JobSpec {
    day: string;
    hour: number;
    lengthH: number;
    cleaner: string | null;
    price: number;
    jobType?: string;
    completed?: { inAt: Date; outAt: Date };
  }
  async function job(s: JobSpec): Promise<{ id: string; start: Date; end: Date }> {
    const cl = nextClient();
    const start = at(s.day, s.hour);
    const end = minutes(start, s.lengthH * 60);
    const j = await db.job.create({
      data: {
        ...o,
        jobNumber: jobNumber++,
        clientName: cl.c.name,
        clientId: cl.id,
        clientAddressId: cl.addressId,
        location: cl.c.address,
        postalCode: cl.c.postal,
        jobType: s.jobType ?? "Standard Clean",
        propertyType: cl.c.type,
        bedCount: cl.c.beds,
        bathCount: cl.c.baths,
        jobDate: start,
        startTime: start,
        endTime: end,
        status: s.completed ? "COMPLETED" : "SCHEDULED",
        clockInTime: s.completed?.inAt ?? null,
        clockOutTime: s.completed?.outAt ?? null,
        price: s.price,
        subtotalAmount: s.price,
        totalAmount: s.price,
        requiredCleaners: 1,
        employeeId: s.cleaner,
        checklistTemplateId: template.id,
        notes: "Demo booking. Bring your own vacuum.",
        // Nothing about a demo booking may message its (made-up) client.
        notifyClient: false,
        smsConsent: false,
        paymentReceived: !!s.completed,
        ...(s.cleaner ? { cleaners: { connect: [{ id: s.cleaner }] } } : {}),
      },
      select: { id: true },
    });
    if (s.cleaner) {
      await db.jobAssignment.create({
        data: {
          ...o, jobId: j.id, cleanerId: s.cleaner,
          status: s.completed ? "COMPLETED" : "ASSIGNED",
          clockInTime: s.completed?.inAt ?? null,
          clockOutTime: s.completed?.outAt ?? null,
        },
      });
      if (s.completed) {
        await db.jobWorkSession.create({
          data: { ...o, jobId: j.id, cleanerId: s.cleaner, startedAt: s.completed.inAt, endedAt: s.completed.outAt },
        });
      }
    }
    return { id: j.id, start, end };
  }
  const done = (day: string, hour: number, lengthH: number) => ({
    inAt: minutes(at(day, hour), 3),
    outAt: minutes(at(day, hour), lengthH * 60 - 4),
  });

  // ── Upcoming: Alex twice a day for 21 days, starting today ───────────────
  let alexUpcoming = 0;
  let othersUpcoming = 0;
  const crew = [ids.maya, ids.jordan, ids.sam, ids.lead];
  for (let d = 0; d < DAYS_AHEAD; d++) {
    const day = addDays(today, d);
    await job({ day, hour: 9, lengthH: 3, cleaner: ids.alex, price: 180 });
    await job({ day, hour: 13, lengthH: 3, cleaner: ids.alex, price: 200, jobType: d % 3 === 2 ? "Deep Clean" : "Standard Clean" });
    alexUpcoming += 2;
    if (d % 2 === 0) {
      await job({ day, hour: 10, lengthH: 3, cleaner: crew[(d / 2) % crew.length], price: 170 });
      othersUpcoming++;
    }
  }

  // ── Open board: three unassigned, claimable jobs in each of the 3 weeks ──
  let open = 0;
  for (let w = 0; w < 3; w++) {
    for (const offset of [1, 3, 5]) {
      await job({ day: addDays(today, w * 7 + offset), hour: 11, lengthH: 3, cleaner: null, price: 190 });
      open++;
    }
  }

  // ── Past: completed weekdays from two pay weeks back until yesterday ─────
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const paidWeekStart = addDays(monday, -14);
  const paidWeekEnd = addDays(monday, -8);
  let pastCompleted = 0;
  const paidWeekJobs: number[] = [];
  let paidWeekMinutes = 0;
  for (let key = paidWeekStart; key < today; key = addDays(key, 1)) {
    const wd = weekday(key);
    if (wd === 0 || wd === 6) continue;
    const price = 200;
    await job({ day: key, hour: 9, lengthH: 3, cleaner: ids.alex, price, completed: done(key, 9, 3) });
    pastCompleted++;
    if (key <= paidWeekEnd) {
      paidWeekJobs.push(price);
      paidWeekMinutes += 3 * 60 - 7;
    }
  }
  // A few finished jobs for the rest of the crew; one carries a time request.
  const mayaDay = addDays(today, -2);
  const mayaJob = await job({ day: mayaDay, hour: 10, lengthH: 3, cleaner: ids.maya, price: 170, completed: done(mayaDay, 10, 3) });
  pastCompleted++;
  for (const [n, who] of [[3, ids.jordan], [4, ids.sam], [5, ids.lead]] as const) {
    const key = addDays(today, -n);
    await job({ day: key, hour: 10, lengthH: 3, cleaner: who, price: 170, completed: done(key, 10, 3) });
    pastCompleted++;
  }

  await db.organization.update({ where: { id: orgId }, data: { nextJobNumber: jobNumber } });

  // ── Pay: a PAID week for Alex, and one past withdrawal ───────────────────
  const base = paidWeekJobs.reduce(
    (sum, price) => sum + (computeJobPayout(price, [fallbackRateInput(ids.alex)]).shares[0]?.amount ?? 0),
    0,
  );
  const paidAt = at(addDays(monday, -5), 10);
  const period = await db.payPeriod.create({
    data: {
      ...o, startDate: at(paidWeekStart, 0), endDate: at(paidWeekEnd, 23, 59, 59, 999), status: "PAID",
      approvedById: ids.owner, approvedAt: minutes(paidAt, -60), paidAt, notes: "Demo pay week.",
    },
    select: { id: true },
  });
  const baseAmount = Math.round(base * 100) / 100;
  await db.payout.create({
    data: {
      ...o, payPeriodId: period.id, employeeId: ids.alex, baseAmount, finalAmount: baseAmount,
      jobCount: paidWeekJobs.length, totalHours: Math.round((paidWeekMinutes / 60) * 100) / 100,
    },
  });
  // Leaves about $300 withdrawable: the payout less $100 taken out (net + fee).
  const withdrawnGross = Math.max(0, Math.round((baseAmount - 300) * 100) / 100);
  const fee = Math.round(withdrawnGross * 0.05 * 100) / 100;
  if (withdrawnGross > 0) {
    await db.withdrawal.create({
      data: {
        ...o, employeeId: ids.alex, amount: Math.round((withdrawnGross - fee) * 100) / 100, feeAmount: fee,
        status: "COMPLETED", paymentMethod: "E_TRANSFER", processedAt: minutes(paidAt, 26 * 60),
        processedById: ids.owner, createdAt: minutes(paidAt, 24 * 60),
      },
    });
  }

  // ── Office chat: Alex and the office ─────────────────────────────────────
  const t0 = minutes(now, -2 * 24 * 60);
  const conv = await db.chatConversation.create({
    data: {
      ...o, employeeId: ids.alex, lastMessageAt: minutes(t0, 95),
      lastEmployeeMessageAt: minutes(t0, 40), lastAdminMessageAt: minutes(t0, 95),
    },
    select: { id: true },
  });
  const office = [
    { by: ids.manager, role: "ADMIN" as const, body: "Hi Alex, welcome to Bookmops Demo! Your next three weeks of jobs are in the app.", m: 0 },
    { by: ids.alex, role: "EMPLOYEE" as const, body: "Thanks! Is there parking at 100 Example St?", m: 40 },
    { by: ids.manager, role: "ADMIN" as const, body: "Yes, use the visitor spots out front. Message us here if you need supplies.", m: 95 },
  ];
  for (const msg of office) {
    const createdAt = minutes(t0, msg.m);
    await db.chatMessage.create({
      data: {
        ...o, conversationId: conv.id, senderId: msg.by, senderRole: msg.role, body: msg.body, createdAt,
        deliveredAt: createdAt,
        // The last office message is left unread, so the badge shows.
        readByAdminAt: msg.role === "EMPLOYEE" ? minutes(createdAt, 5) : null,
        readByEmployeeAt: msg.role === "ADMIN" && msg.m < 95 ? minutes(createdAt, 10) : null,
      },
    });
  }

  // ── Team chat: the default channel, as ensureDefaultChannel() names it ───
  const channel = await db.groupChannel.create({
    data: { ...o, name: "All Cleaners", isDefault: true, isActive: true, createdById: ids.owner },
    select: { id: true },
  });
  const team = [
    { by: "lead", body: "Morning team! Reminder: fresh microfiber cloths are in the office.", m: -26 * 60 },
    { by: "maya", body: "Thanks Taylor, grabbing some before my 10 o'clock.", m: -25 * 60 },
    { by: "alex", body: "Does anyone have a spare extension pole I can borrow this week?", m: -5 * 60 },
    { by: "jordan", body: "I do, I'll leave it at the office for you.", m: -4 * 60 },
  ] as const;
  for (const msg of team) {
    await db.groupMessage.create({
      data: {
        ...o, channelId: channel.id, senderId: ids[msg.by], senderName: PEOPLE[msg.by].name,
        body: msg.body, createdAt: minutes(now, msg.m),
      },
    });
  }

  // ── Announcement ─────────────────────────────────────────────────────────
  await db.announcement.create({
    data: {
      ...o, title: "Welcome to Bookmops Demo", pinned: true, authorId: ids.owner, authorName: PEOPLE.owner.name,
      body: "This is a demonstration workspace with made-up clients and jobs. Check the Available tab for open jobs you can claim, and tap On my way before each visit.",
      createdAt: minutes(now, -3 * 24 * 60),
    },
  });

  // ── Kit ──────────────────────────────────────────────────────────────────
  const product = (name: string, unit: string, itemType: "LIQUID" | "COUNTABLE_CONSUMABLE" | "REUSABLE_EQUIPMENT", restock: number) =>
    db.product.create({
      data: { ...o, name, unit, itemType, costPerUnit: 5, stockLevel: 40, minStock: 10, cleanerRestockThreshold: restock, category: "OTHER" },
      select: { id: true },
    });
  const apc = await product("All-purpose cleaner", "bottle", "LIQUID", 1);
  const cloths = await product("Microfiber cloths", "cloth", "COUNTABLE_CONSUMABLE", 6);
  const bags = await product("Trash bags", "bag", "COUNTABLE_CONSUMABLE", 10);
  const vacuum = await product("Canister vacuum", "unit", "REUSABLE_EQUIPMENT", 0);
  const kit: Omit<Prisma.EmployeeProductUncheckedCreateInput, "organizationId">[] = [
    { employeeId: ids.alex, productId: apc.id, quantity: 2, levelStatus: "GOOD" },
    { employeeId: ids.alex, productId: cloths.id, quantity: 12 },
    { employeeId: ids.alex, productId: bags.id, quantity: 4 }, // below 10: shows as low
    { employeeId: ids.alex, productId: vacuum.id, quantity: 1, condition: "AVAILABLE" },
    { employeeId: ids.jordan, productId: bags.id, quantity: 2 },
  ];
  for (const k of kit) {
    await db.employeeProduct.create({ data: { ...o, ...k, statusUpdatedAt: now } });
  }

  // ── Training: one module, no video, a 3-question quiz ────────────────────
  const trainingModule = await db.trainingModule.create({
    data: {
      ...o, title: "Welcome: how we clean", duration: 10, isRequired: true, sortOrder: 1, isActive: true,
      description:
        "Work top to bottom and dry to wet. Start in the kitchen, finish with floors, and check every item on the job's checklist before you clock out.",
    },
    select: { id: true },
  });
  const quiz = [
    { q: "Which direction should you clean a room in?", options: ["Bottom to top", "Top to bottom", "Any order"], correct: 1 },
    { q: "What do you do before clocking out?", options: ["Check the job's checklist", "Nothing", "Call the client"], correct: 0 },
    { q: "Which area is usually cleaned last?", options: ["Kitchen counters", "Mirrors", "Floors"], correct: 2 },
  ];
  for (const [i, item] of quiz.entries()) {
    await db.trainingQuiz.create({
      data: {
        ...o, moduleId: trainingModule.id, question: item.q, sortOrder: i + 1,
        options: item.options.map((text, idx) => ({ text, isCorrect: idx === item.correct })),
      },
    });
  }

  // ── Document to sign ─────────────────────────────────────────────────────
  const doc = await db.document.create({
    data: {
      ...o, title: "Workplace safety policy", version: "1.0", dueDate: at(addDays(today, 14), 17),
      description: "Please read and sign.",
      content: [
        "Bookmops Demo - Workplace safety policy",
        "",
        "1. Wear gloves when using any cleaning product.",
        "2. Never mix cleaning products.",
        "3. Keep walkways clear and put up a wet-floor sign when mopping.",
        "4. Report any injury or damage to the office the same day.",
        "",
        "This is a demonstration document.",
      ].join("\n"),
    },
    select: { id: true },
  });
  for (const who of [ids.alex, ids.maya, ids.jordan, ids.sam]) {
    await db.documentSignature.create({ data: { ...o, documentId: doc.id, employeeId: who, status: "PENDING" } });
  }

  // ── Approvals for the manager side ───────────────────────────────────────
  const mayaSession = await db.jobWorkSession.findFirst({
    where: { organizationId: orgId, jobId: mayaJob.id, cleanerId: ids.maya },
    select: { id: true, startedAt: true, endedAt: true },
  });
  await db.timeLogChangeRequest.create({
    data: {
      ...o, jobId: mayaJob.id, cleanerId: ids.maya, sessionId: mayaSession?.id ?? null,
      originalStart: mayaSession?.startedAt ?? null, originalEnd: mayaSession?.endedAt ?? null,
      requestedStart: mayaSession?.startedAt ?? null,
      requestedEnd: mayaSession?.endedAt ? minutes(mayaSession.endedAt, 30) : null,
      reason: "I stayed 30 minutes longer to finish the oven and forgot to clock out on time.",
      status: "PENDING", source: "CLEANER_REQUEST",
    },
  });
  await db.inventoryRequest.create({
    data: { ...o, employeeId: ids.jordan, productId: bags.id, quantity: 20, reason: "Down to my last two bags.", status: "PENDING" },
  });

  return {
    clients: clients.length,
    jobs: { alexUpcoming, othersUpcoming, open, pastCompleted },
    paidPayout: baseAmount,
    pastWithdrawal: withdrawnGross,
    expectedAvailable: Math.round((baseAmount - withdrawnGross) * 100) / 100,
    officeMessages: office.length,
    teamMessages: team.length,
    announcements: 1,
    kitItemsForAlex: 4,
    trainingModules: 1,
    quizQuestions: quiz.length,
    documentsToSign: 1,
    availabilityDays: 5,
    approvals: { timeChange: 1, restock: 1 },
  };
}

async function countOrgRows(db: PrismaClient, orgId: string): Promise<Record<string, number>> {
  const w = { organizationId: orgId };
  // One at a time: the session pooler caps connections, and this is a report.
  const queries: [string, () => Promise<number>][] = [
    ["users", () => db.user.count({ where: w })],
    ["clients", () => db.client.count({ where: w })],
    ["jobs", () => db.job.count({ where: w })],
    ["openJobs", () => db.job.count({ where: { ...w, employeeId: null, status: "SCHEDULED" } })],
    ["payouts", () => db.payout.count({ where: w })],
    ["withdrawals", () => db.withdrawal.count({ where: w })],
    ["officeMessages", () => db.chatMessage.count({ where: w })],
    ["teamMessages", () => db.groupMessage.count({ where: w })],
    ["announcements", () => db.announcement.count({ where: w })],
    ["kitRows", () => db.employeeProduct.count({ where: w })],
    ["trainingModules", () => db.trainingModule.count({ where: w })],
    ["documentAssignments", () => db.documentSignature.count({ where: w })],
    ["availabilityRows", () => db.employeeAvailability.count({ where: w })],
    ["timeRequests", () => db.timeLogChangeRequest.count({ where: w })],
    ["restockRequests", () => db.inventoryRequest.count({ where: w })],
    ["emailOrSmsNotificationsOn", () => db.notificationSetting.count({ where: { ...w, enabled: true, channel: { in: ["EMAIL", "SMS"] } } })],
    ["appSettings", () => db.appSetting.count({ where: w })],
  ];
  const out: Record<string, number> = {};
  for (const [name, q] of queries) out[name] = await q();
  return out;
}

/**
 * Read-only: what the review account will see, through the app's own
 * predicates (lib/cleaner-jobs.ts, the balance definition in server/pay).
 */
async function verify(db: PrismaClient, orgId: string, now: Date): Promise<boolean> {
  const alex = await db.user.findFirst({
    where: { organizationId: orgId, email: PEOPLE.alex.email },
    select: { id: true, isActive: true, mustChangePassword: true, deletedAt: true },
  });
  if (!alex) throw new Error("review account missing");
  const today = dateKeyIn(now);
  const scoped = (extra: Prisma.JobWhereInput): Prisma.JobWhereInput => {
    const base = cleanerAssignedWhere(alex.id);
    return { ...base, organizationId: orgId, AND: [...(base.AND as Prisma.JobWhereInput[]), extra] };
  };
  const todays = await db.job.findMany({
    where: scoped({ startTime: { gte: at(today, 0), lt: at(addDays(today, 1), 0) }, status: { not: "CANCELLED" } }),
    select: { startTime: true },
    orderBy: { startTime: "asc" },
  });
  const lastDay = addDays(today, DAYS_AHEAD - 1);
  const lastDays = await db.job.count({
    where: scoped({ startTime: { gte: at(lastDay, 0), lt: at(addDays(lastDay, 1), 0) } }),
  });
  const claimableBase = claimableJobsWhere(alex.id, now);
  const board = await db.job.findMany({
    where: { ...claimableBase, organizationId: orgId },
    select: { requiredCleaners: true, cleaners: { select: { id: true } } },
  });
  const open = board.filter((j) => j.cleaners.length < j.requiredCleaners).length;
  const [payouts, withdrawals] = await Promise.all([
    db.payout.findMany({
      where: { organizationId: orgId, employeeId: alex.id, payPeriod: { status: "PAID" } },
      select: { baseAmount: true, adjustments: true, deductions: true, reimbursements: true },
    }),
    db.withdrawal.findMany({
      where: { organizationId: orgId, employeeId: alex.id, status: { in: [...RESERVING_WITHDRAWAL_STATUSES] } },
      select: { amount: true, feeAmount: true },
    }),
  ]);
  const availableCents =
    toCents(summarisePayouts(payouts).totalFinal) - withdrawals.reduce((s, w) => s + reservedCentsOf(w), 0);
  const conv = await db.chatConversation.findFirst({ where: { organizationId: orgId, employeeId: alex.id }, select: { id: true } });
  const unreadOffice = conv
    ? await db.chatMessage.count({ where: { conversationId: conv.id, senderRole: "ADMIN", readByEmployeeAt: null } })
    : 0;
  const defaultChannels = await db.groupChannel.count({ where: { organizationId: orgId, isDefault: true } });
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { status: true, timezone: true, smsNumber: true, stripeSecretKeyEnc: true, twilioAccountSid: true, subscription: { select: { status: true, stripeSubscriptionId: true } } },
  });
  const loud = await db.notificationSetting.count({ where: { organizationId: orgId, enabled: true, channel: { in: ["EMAIL", "SMS"] } } });
  const notifyingJobs = await db.job.count({ where: { organizationId: orgId, notifyClient: true } });
  const devices = await db.pushDevice.count({ where: { organizationId: orgId } });
  const nonExample = await db.user.count({ where: { organizationId: orgId, NOT: { email: { endsWith: "@example.com" } } } })
    + await db.client.count({ where: { organizationId: orgId, NOT: { email: { endsWith: "@example.com" } } } });
  const badPhones = await db.client.count({ where: { organizationId: orgId, NOT: { phone: { startsWith: "+1416555010" } } } });

  const checks: [string, boolean, unknown][] = [
    ["review account active, no forced password change", alex.isActive && !alex.mustChangePassword && !alex.deletedAt, alex],
    ["2 jobs today for the review account", todays.length === 2, todays.map((t) => t.startTime.toISOString())],
    ["2 jobs on the last seeded day", lastDays === 2, lastDays],
    ["open, claimable jobs on the board >= 3", open >= 3, open],
    ["withdrawable balance is $300.00", availableCents === 30000, availableCents],
    ["one unread office message", unreadOffice === 1, unreadOffice],
    ["one default team channel", defaultChannels === 1, defaultChannels],
    ["workspace active, Toronto, no SMS number, no Stripe, no Twilio",
      org?.status === "ACTIVE" && org.timezone === TZ && !org.smsNumber && !org.stripeSecretKeyEnc && !org.twilioAccountSid, org],
    ["subscription ACTIVE, not linked to Stripe", org?.subscription?.status === "ACTIVE" && !org.subscription.stripeSubscriptionId, org?.subscription],
    ["no EMAIL/SMS notification switched on", loud === 0, loud],
    ["no job notifies its client", notifyingJobs === 0, notifyingJobs],
    ["no seeded push devices (the review phone may add its own)", true, devices],
    ["every email is @example.com", nonExample === 0, nonExample],
    ["every client phone is 555-01xx", badPhones === 0, badPhones],
  ];
  let ok = true;
  for (const [name, pass, detail] of checks) {
    ok &&= pass;
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  ${JSON.stringify(detail)}`}`);
  }
  return ok;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mode = parseMode();
  const { db, target } = openTarget();
  try {
    const existing = await findDemoOrg(db);
    const clash = await emailsElsewhere(db, existing?.id ?? null);
    console.log(`mode: ${mode}`);
    console.log(`workspace "${SLUG}": ${existing ? `exists (demo, ${existing.id})` : "free"}`);
    console.log(`demo emails already in another workspace: ${clash.length ? clash.join(", ") : "none"}`);
    if (clash.includes(PEOPLE.alex.email)) {
      throw new Error(`STOP: ${PEOPLE.alex.email} already exists in another workspace. Nothing was changed.`);
    }

    if (mode === "dry-run") {
      console.log(existing ? "would refresh the demo workspace's data (people and password kept)" : "would create the demo workspace");
      if (existing) console.log(JSON.stringify(await countOrgRows(db, existing.id), null, 2));
      return;
    }

    if (mode === "verify") {
      if (!existing) throw new Error("no demo workspace to verify");
      if (!(await verify(db, existing.id, new Date()))) process.exitCode = 1;
      return;
    }

    if (mode === "teardown") {
      if (!existing) {
        console.log("nothing to tear down");
        return;
      }
      await teardown(db, existing);
      const left = await db.organization.count({ where: { slug: SLUG } });
      const users = await db.user.count({ where: { organizationId: existing.id } });
      console.log(`torn down: organization rows left ${left}, users left ${users}`);
      return;
    }

    // apply
    const now = new Date();
    let password: string | null = null;
    let orgId: string;
    let ids: Record<PersonKey, string>;
    if (!existing) {
      password = strongPassword();
      ({ orgId, ids } = await createWorkspace(db, password));
      console.log(`created workspace ${SLUG} (${orgId})`);
    } else {
      orgId = existing.id;
      ids = await peopleOf(db, orgId);
      await clearOrgTables(db, orgId, KEEP_ON_REFRESH);
      console.log("cleared demo data for refresh (people, passwords, sessions kept)");
      if (has("reset-password")) {
        password = strongPassword();
        const hashed = await hashPassword(password);
        await db.account.updateMany({
          where: { providerId: "credential", userId: { in: Object.values(ids) } },
          data: { password: hashed },
        });
        console.log("password reset for every demo account");
      }
    }

    await upsertSettings(db, orgId);
    const seeded = await seedData(db, orgId, ids, now);
    console.log("seeded:", JSON.stringify(seeded, null, 2));
    console.log("counts:", JSON.stringify(await countOrgRows(db, orgId), null, 2));
    console.log(`company date: ${dateKeyIn(now)}; jobs run to ${addDays(dateKeyIn(now), DAYS_AHEAD - 1)} — re-run --apply to extend`);
    console.log("people:");
    for (const p of Object.values(PEOPLE)) console.log(`  ${p.email.padEnd(28)} ${p.role.padEnd(11)} ${p.name}`);

    if (password) {
      const file = val("credentials-file");
      if (file) {
        writeFileSync(
          file,
          [
            `Bookmops Demo (${target}) - https://${SLUG}.useawer.com`,
            `Password for every account below: ${password}`,
            ...Object.values(PEOPLE).map((p) => `  ${p.email}  (${p.role})`),
            "",
          ].join("\n"),
          { mode: 0o600 },
        );
        chmodSync(file, 0o600);
        console.log(`credentials written to ${file} (mode 600)`);
      }
      // Printed once, here, on purpose: this is the only moment it exists in clear.
      console.log(`\nPASSWORD (all demo accounts): ${password}\n`);
    } else {
      console.log("password unchanged (use --reset-password to rotate it)");
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
