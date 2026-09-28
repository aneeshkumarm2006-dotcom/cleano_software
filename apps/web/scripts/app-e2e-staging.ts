/**
 * Bookmops Pro, end to end, through the app's own code path, against a local
 * server connected to STAGING.
 *
 *   # 1. the web app on :3200 at *.127-0-0-1.nip.io (apps/staff/README.md,
 *   #    "Running against a real server"), DATABASE_URL the staging app role
 *   # 2. then, from apps/web:
 *   FIXTURE_DATABASE_URL="$STAGING_DIRECT_URL" npx tsx scripts/app-e2e-staging.ts
 *
 * Unlike scripts/api-v1-integration.ts, which speaks raw HTTP, every call
 * here goes through what the phone runs: `createPlatformClient` for
 * discovery, a Better Auth client with the Expo plugin's cookie handling for
 * sign-in and sign-out (the plugin itself needs React Native, so its fetch
 * hooks are reproduced below line for line), and `createClient` for the rest,
 * so every response is parsed by the same zod contracts.
 *
 * It creates one throwaway company (E2E_APP_SLUG, default "e2eapp") with one
 * person per role and the data each flow needs, walks the flows, prints a
 * PASS/FAIL table, and deletes the company. Flags:
 *   --keep     leave the company for a look in the simulator
 *   --cleanup  only delete the company
 *
 * Synthetic data only: `.test` emails, no phone numbers. The server must run
 * without RESEND_API_KEY, TWILIO_* and EXPO_ACCESS_TOKEN.
 */
import { randomUUID } from "node:crypto";

import { ApiError, createClient, createPlatformClient, type ApiClient } from "@bookmops/api/client";
import { crewWarningsHash } from "@bookmops/api/v1";
import type { PrismaClient, Roles } from "@prisma/client";
import { createAuthClient } from "better-auth/client";
import { parseSetCookieHeader } from "better-auth/cookies";
import { hashPassword } from "better-auth/crypto";

import { openDb } from "./api-v1/fixture";

const SLUG = process.env.E2E_APP_SLUG ?? "e2eapp";
const PORT = Number(process.env.E2E_APP_PORT ?? 3200);
const LAN = process.env.E2E_APP_LAN ?? "127-0-0-1";
const PLATFORM_URL = `http://www.${LAN}.nip.io:${PORT}`;
const COMPANY_ORIGIN = `http://${SLUG}.${LAN}.nip.io:${PORT}`;
export const E2E_PASSWORD = "E2e-App-Pass-2026!";
const APP_VERSION = "1.0.0 (1)";
const KEEP = process.argv.includes("--keep");
const CLEANUP_ONLY = process.argv.includes("--cleanup");
const HOUR = 3600_000;

// ── The Expo plugin's cookie jar, reproduced (@better-auth/expo 1.4.22) ──────

const COOKIE_PREFIX = ["better-auth", "__Secure-better-auth"];

function getSetCookie(header: string, prevCookie?: string): string {
  const parsed = parseSetCookieHeader(header);
  let toSetCookie: Record<string, { value: string; expires: string | null }> = {};
  parsed.forEach((cookie, key) => {
    const expiresAt = cookie["expires"];
    const maxAge = cookie["max-age"];
    const expires = maxAge ? new Date(Date.now() + Number(maxAge) * 1e3) : expiresAt ? new Date(String(expiresAt)) : null;
    toSetCookie[key] = { value: cookie["value"], expires: expires ? expires.toISOString() : null };
  });
  if (prevCookie) {
    try {
      toSetCookie = { ...JSON.parse(prevCookie), ...toSetCookie };
    } catch {
      // as the plugin: a corrupt store is replaced
    }
  }
  return JSON.stringify(toSetCookie);
}

function getCookie(cookie: string): string {
  let parsed: Record<string, { value: string; expires: string | null }> = {};
  try {
    parsed = JSON.parse(cookie);
  } catch {
    // as the plugin
  }
  return Object.entries(parsed).reduce((acc, [key, value]) => {
    if (value.expires && new Date(value.expires) < new Date()) return acc;
    return acc ? `${acc}; ${key}=${value.value}` : `${key}=${value.value}`;
  }, "");
}

function hasBetterAuthCookies(setCookieHeader: string): boolean {
  for (const name of parseSetCookieHeader(setCookieHeader).keys()) {
    const bare = name.replace(/^__Secure-/, "");
    if (COOKIE_PREFIX.some((p) => bare.startsWith(p))) return true;
  }
  return false;
}

/** Secure storage, one per phone: key → JSON cookie store. */
type Storage = Map<string, string>;

/**
 * createCompanyAuthClient (apps/staff/src/auth/auth-client.ts) with the Expo
 * plugin's fetch hooks: the session cookie is kept in storage under
 * `bookmopspro.<orgId>_cookie`, sent as an explicit `cookie` header with
 * credentials omitted, and `expo-origin: bookmopspro://` stands in for the
 * Origin a native app doesn't have (the server's expo() plugin promotes it).
 */
function companyAuthClient(origin: string, orgId: string, storage: Storage) {
  const cookieName = `bookmopspro.${orgId}_cookie`;
  const plugin = {
    id: "expo",
    getActions: () => ({ getCookie: () => getCookie(storage.get(cookieName) || "{}") }),
    fetchPlugins: [
      {
        id: "expo",
        name: "Expo",
        hooks: {
          async onSuccess(context: { response: Response }) {
            const setCookie = context.response.headers.get("set-cookie");
            if (setCookie && hasBetterAuthCookies(setCookie)) {
              storage.set(cookieName, getSetCookie(setCookie, storage.get(cookieName) ?? undefined));
            }
          },
        },
        async init(url: string, options?: Record<string, unknown>) {
          const opts = (options ?? {}) as { headers?: Record<string, string>; credentials?: string };
          opts.credentials = "omit";
          opts.headers = {
            ...opts.headers,
            cookie: getCookie(storage.get(cookieName) || "{}"),
            "expo-origin": "bookmopspro://",
            "x-skip-oauth-proxy": "true",
          };
          if (url.includes("/sign-out")) storage.set(cookieName, "{}");
          return { url, options: opts };
        },
      },
    ],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createAuthClient({ baseURL: origin, plugins: [plugin as any] });
  // The plugin's getCookie action, typed: what session.tsx passes to createClient.
  return { client, getCookie: () => plugin.getActions().getCookie() };
}

// ── The table ─────────────────────────────────────────────────────────────────

interface Row {
  role: string;
  step: string;
  ok: boolean;
  detail: string;
}
const rows: Row[] = [];
/** The last response body each client saw, for the detail of a BAD_RESPONSE. */
const lastBody = new Map<string, string>();

function describe(e: unknown, who: string): string {
  if (e instanceof ApiError) {
    const extra = e.code === "BAD_RESPONSE" ? ` body=${(lastBody.get(who) ?? "").slice(0, 400)}` : "";
    return `${e.status} ${e.code}: ${e.message}${extra}`;
  }
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

async function step<T>(role: string, name: string, fn: () => Promise<T>, check?: (v: T) => string | null): Promise<T | undefined> {
  try {
    const v = await fn();
    const problem = check ? check(v) : null;
    rows.push({ role, step: name, ok: !problem, detail: problem ?? "" });
    console.log(`${problem ? "FAIL" : "PASS"}  [${role}] ${name}${problem ? `  — ${problem}` : ""}`);
    return v;
  } catch (e) {
    const d = describe(e, role);
    rows.push({ role, step: name, ok: false, detail: d });
    console.log(`FAIL  [${role}] ${name}  — ${d}`);
    return undefined;
  }
}

/** A step that must be refused with one of `statuses`. */
async function refused(role: string, name: string, statuses: number[], fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    rows.push({ role, step: name, ok: false, detail: "was allowed" });
    console.log(`FAIL  [${role}] ${name}  — was allowed`);
  } catch (e) {
    const ok = e instanceof ApiError && statuses.includes(e.status);
    rows.push({ role, step: name, ok, detail: ok ? "" : describe(e, role) });
    console.log(`${ok ? "PASS" : "FAIL"}  [${role}] ${name}${ok ? ` (${(e as ApiError).status})` : `  — ${describe(e, role)}`}`);
  }
}

// ── The phone ─────────────────────────────────────────────────────────────────

interface Phone {
  who: string;
  api: ApiClient;
  auth: ReturnType<typeof companyAuthClient>;
}

const platform = createPlatformClient({ baseUrl: PLATFORM_URL, appVersion: APP_VERSION, platform: "ios" });

/** session.tsx's signIn: discovery on the platform host, then sign-in at the company's own address. */
async function signIn(who: string, email: string): Promise<Phone | undefined> {
  const found = await step(who, "discover workspace", () => platform.workspaces(email, E2E_PASSWORD), (r) =>
    r.workspaces.length !== 1
      ? `expected one workspace, got ${r.workspaces.length}`
      : r.workspaces[0].apiOrigin !== COMPANY_ORIGIN
        ? `apiOrigin ${r.workspaces[0].apiOrigin}, expected ${COMPANY_ORIGIN}`
        : null,
  );
  const ws = found?.workspaces[0];
  if (!ws) return undefined;
  // What isAllowedOrigin checks in a dev build: exactly EXPO_PUBLIC_DEV_ORIGIN.
  if (new URL(ws.apiOrigin).origin !== COMPANY_ORIGIN) return undefined;

  const storage: Storage = new Map();
  const auth = companyAuthClient(ws.apiOrigin, ws.orgId, storage);
  const res = await step(who, "sign in (better-auth, Expo cookies)", () => auth.client.signIn.email({ email, password: E2E_PASSWORD }), (r) =>
    r.error ? `${r.error.status} ${r.error.message}` : auth.getCookie() ? null : "no session cookie stored",
  );
  if (!res || res.error) return undefined;

  const api = createClient({
    baseUrl: ws.apiOrigin,
    appVersion: APP_VERSION,
    platform: "ios",
    getCookie: () => auth.getCookie(),
    // The default fetch, teed so a failure can show what the server sent.
    fetch: async (input, init) => {
      const r = await fetch(input, init);
      lastBody.set(who, await r.clone().text());
      return r;
    },
  });
  return { who, api, auth };
}

const ev = () => ({
  clientEventId: randomUUID(),
  occurredAt: new Date().toISOString(),
  clock: { source: "synced" as const, offsetMs: 0 },
});

const has = (ids: string[], id: string, label: string) => (ids.includes(id) ? null : `${label} missing`);

// ── The company ───────────────────────────────────────────────────────────────

interface World {
  orgId: string;
  users: Record<"cleaner" | "teammate" | "outsider" | "lead" | "ops" | "admin", { id: string; email: string }>;
  jobs: Record<"mine" | "mineLater" | "outsider" | "open" | "tomorrow", string>;
  time: Record<"group" | "lead" | "outsider", string>;
  documentId: string;
  moduleId: string;
  kitRequestId: string;
  issueId: string;
  announcementId: string;
}

async function removeCompany(db: PrismaClient): Promise<void> {
  const org = await db.organization.findFirst({ where: { slug: SLUG }, select: { id: true } });
  if (!org) return;
  const users = await db.user.findMany({ where: { organizationId: org.id }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  if (userIds.length) {
    await db.session.deleteMany({ where: { userId: { in: userIds } } });
    await db.account.deleteMany({ where: { userId: { in: userIds } } });
    await db.verification.deleteMany({ where: { value: { in: userIds } } });
  }
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId'
      AND table_name NOT IN ('Organization', 'User')`;
  let pending = tables.map((t) => t.table_name);
  for (let pass = 0; pass < 8 && pending.length > 0; pass++) {
    const failed: string[] = [];
    for (const table of pending) {
      try {
        await db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, org.id);
      } catch {
        failed.push(table);
      }
    }
    pending = failed;
  }
  if (pending.length) throw new Error(`could not clear: ${pending.join(", ")}`);
  await db.user.updateMany({ where: { organizationId: org.id }, data: { fieldLeadId: null } });
  await db.user.deleteMany({ where: { organizationId: org.id } });
  await db.organization.delete({ where: { id: org.id } });
}

async function createCompany(db: PrismaClient): Promise<World> {
  await removeCompany(db);
  const hashed = await hashPassword(E2E_PASSWORD);
  const org = await db.organization.create({
    data: { slug: SLUG, name: "E2E App Cleaning", status: "ACTIVE", plan: "PROFESSIONAL", timezone: "America/Toronto" },
    select: { id: true },
  });
  const A = org.id;

  async function person(local: string, name: string, role: Roles, fieldLeadId?: string) {
    const email = `${local}@${SLUG}.test`;
    const u = await db.user.create({
      data: { organizationId: A, name, email, role, emailVerified: true, isActive: true, ...(fieldLeadId ? { fieldLeadId } : {}) },
      select: { id: true, email: true },
    });
    await db.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: hashed } });
    return u;
  }
  const lead = await person("lead", "Lena Lead", "FIELD_LEAD");
  const users = {
    lead,
    cleaner: await person("cleaner", "Casey Cleaner", "EMPLOYEE", lead.id),
    teammate: await person("teammate", "Tara Teammate", "EMPLOYEE", lead.id),
    outsider: await person("outsider", "Omar Outsider", "EMPLOYEE"),
    ops: await person("ops", "Olive Ops", "OPS_MANAGER"),
    admin: await person("admin", "Adam Admin", "ADMIN"),
  };

  const now = Date.now();
  let n = 7100;
  async function job(startMs: number, label: string, crew: string[], extra: Record<string, unknown> = {}) {
    const start = new Date(startMs);
    const j = await db.job.create({
      data: {
        organizationId: A,
        jobNumber: n++,
        clientName: `Prem Sai ${label}`,
        employeeId: crew[0] ?? null,
        jobType: "Standard Clean",
        location: `${n} Test Street, Testville, ON`,
        startTime: start,
        endTime: new Date(start.getTime() + 3 * HOUR),
        jobDate: start,
        status: "SCHEDULED",
        price: 150,
        subtotalAmount: 150,
        requiredCleaners: 1,
        notes: "Test job. Side door.",
        cleaners: { connect: crew.map((id) => ({ id })) },
        ...extra,
      },
      select: { id: true },
    });
    for (const cleanerId of crew) await db.jobAssignment.create({ data: { organizationId: A, jobId: j.id, cleanerId } });
    return j.id;
  }
  const jobs = {
    mine: await job(now + 45 * 60_000, "E2E Morning", [users.cleaner.id]),
    mineLater: await job(now + 4 * HOUR, "E2E Afternoon", [users.cleaner.id]),
    outsider: await job(now + 2 * HOUR, "E2E Outsider", [users.outsider.id]),
    open: await job(now + 50 * HOUR, "E2E Open Board", []),
    tomorrow: await job(now + 26 * HOUR, "E2E Tomorrow", [users.ops.id]),
  };

  // A checklist on the cleaner's first job, pinned to a template as an admin would.
  const template = await db.checklistTemplate.create({
    data: {
      organizationId: A,
      name: "E2E clean",
      items: {
        create: [
          { organizationId: A, title: "Kitchen counters", sortOrder: 1, isRequired: true },
          { organizationId: A, title: "Bathroom mirror", sortOrder: 2, isRequired: false },
        ],
      },
    },
    select: { id: true },
  });
  await db.job.update({ where: { id: jobs.mine }, data: { checklistTemplateId: template.id } });
  await db.jobChecklist.create({
    data: {
      organizationId: A,
      jobId: jobs.mine,
      employeeId: users.cleaner.id,
      items: {
        create: [
          { organizationId: A, title: "Kitchen counters", sortOrder: 1, isRequired: true },
          { organizationId: A, title: "Bathroom mirror", sortOrder: 2, isRequired: false },
        ],
      },
    },
  });

  // Time corrections waiting: one in the lead's group, the lead's own, one outside the group.
  const past = now - 3 * 24 * HOUR;
  const at = (base: number, min: number) => new Date(base + min * 60_000);
  async function timeItem(cleanerId: string, offsetH: number, label: string) {
    const base = past + offsetH * HOUR;
    const jobId = await job(base, label, [cleanerId], { status: "COMPLETED" });
    const s = await db.jobWorkSession.create({
      data: { organizationId: A, jobId, cleanerId, startedAt: at(base, 20), endedAt: at(base, 180) },
      select: { id: true },
    });
    const r = await db.timeLogChangeRequest.create({
      data: { organizationId: A, jobId, cleanerId, sessionId: s.id, requestedStart: at(base, 0), reason: "Forgot to clock in" },
      select: { id: true },
    });
    return r.id;
  }
  const time = {
    group: await timeItem(users.teammate.id, 0, "E2E Past Group"),
    lead: await timeItem(users.lead.id, 4, "E2E Past Lead"),
    outsider: await timeItem(users.outsider.id, 8, "E2E Past Outsider"),
  };

  // Pay: a PAID period with $200 for the cleaner, so there is money to withdraw.
  const period = await db.payPeriod.create({
    data: {
      organizationId: A,
      startDate: new Date(now - 14 * 24 * HOUR),
      endDate: new Date(now - 7 * 24 * HOUR - 1),
      status: "PAID",
      paidAt: new Date(now - 5 * 24 * HOUR),
    },
    select: { id: true },
  });
  await db.payout.create({
    data: { organizationId: A, payPeriodId: period.id, employeeId: users.cleaner.id, baseAmount: 200, deductions: 0, finalAmount: 200, jobCount: 2, totalHours: 6 },
  });

  // Kit: gloves the office gave the cleaner, and a restock the teammate asked for.
  const gloves = await db.product.create({
    data: { organizationId: A, name: "Nitrile gloves", unit: "pairs", costPerUnit: 1, stockLevel: 20 },
    select: { id: true },
  });
  const shelf = await db.inventoryLocation.create({ data: { organizationId: A, name: "Main shelf" }, select: { id: true } });
  await db.inventoryLocationStock.create({ data: { organizationId: A, locationId: shelf.id, productId: gloves.id, quantity: 20 } });
  await db.employeeProduct.create({ data: { organizationId: A, employeeId: users.cleaner.id, productId: gloves.id, quantity: 5 } });
  await db.inventoryChange.create({
    data: { organizationId: A, productId: gloves.id, employeeId: users.cleaner.id, quantityChange: 5, newQuantity: 5, action: "ASSIGN", changedById: users.admin.id },
  });
  const kitRequest = await db.inventoryRequest.create({
    data: { organizationId: A, employeeId: users.teammate.id, productId: gloves.id, quantity: 2, reason: "Running low" },
    select: { id: true },
  });

  // Talk: a team channel, an announcement.
  await db.groupChannel.create({ data: { organizationId: A, name: "General", isDefault: true } });
  const announcement = await db.announcement.create({
    data: { organizationId: A, title: "Welcome to the E2E crew", body: "New gloves are on the main shelf.", pinned: true, authorName: "Office" },
    select: { id: true },
  });

  // Record: training with a quiz, a document to sign, a strike.
  const opts = (correct: number) => ["Bleach", "Vinegar", "Water"].map((text, i) => ({ text, isCorrect: i === correct }));
  const mod = await db.trainingModule.create({
    data: {
      organizationId: A,
      title: "Chemical safety",
      description: "Which products never mix.",
      videoUrl: "https://www.youtube.com/watch?v=e2etest",
      duration: 300,
      isRequired: true,
      sortOrder: 1,
      quizzes: {
        create: [
          { organizationId: A, question: "Never mix with ammonia?", options: opts(0), sortOrder: 1 },
          { organizationId: A, question: "Safe on glass?", options: opts(1), sortOrder: 2 },
        ],
      },
    },
    select: { id: true },
  });
  const doc = await db.document.create({
    data: { organizationId: A, title: "Key policy", description: "Client keys.", version: "1", content: "Keep client keys in the lockbox.\nNever share door codes." },
    select: { id: true },
  });
  await db.documentSignature.create({ data: { organizationId: A, documentId: doc.id, employeeId: users.cleaner.id, status: "PENDING" } });
  await db.cleanerStrike.create({
    data: { organizationId: A, cleanerId: users.cleaner.id, reasonCode: "LATE_45", reason: "45+ minutes late", expiresAt: new Date(now + 20 * 24 * HOUR) } as never,
  });

  // Manager inbox: a problem and an alert.
  const issue = await db.jobIssue.create({
    data: { organizationId: A, jobId: jobs.outsider, reportedByName: "Omar Outsider", category: "OTHER", urgency: "URGENT", status: "OPEN", description: "Broken tap" },
    select: { id: true },
  });
  await db.notification.create({
    data: { organizationId: A, notificationKey: "admin.shift.dropped_urgent", title: "Cover needed for Prem Sai E2E Outsider", body: "Omar needs cover", href: `/admin/jobs/${jobs.outsider}`, severity: "WARN" },
  });

  return {
    orgId: A,
    users,
    jobs,
    time,
    documentId: doc.id,
    moduleId: mod.id,
    kitRequestId: kitRequest.id,
    issueId: issue.id,
    announcementId: announcement.id,
  };
}

// ── The flows ─────────────────────────────────────────────────────────────────

async function cleanerFlow(w: World, teammate: Phone | undefined): Promise<{ withdrawalCents?: number }> {
  const R = "cleaner";
  const p = await signIn(R, w.users.cleaner.email);
  if (!p) return {};
  const { api } = p;
  const J = w.jobs.mine;

  await step(R, "/me", () => api.me(), (m) => (m.person.role === "EMPLOYEE" && m.company.slug === SLUG ? null : `role ${m.person.role}`));
  await step(R, "today", () => api.today(), (t) =>
    has([t.nextJob?.id, ...t.laterToday.map((j) => j.id)].filter(Boolean) as string[], J, "first job") ??
    has(t.laterToday.map((j) => j.id).concat(t.nextJob ? [t.nextJob.id] : []), w.jobs.mineLater, "second job"),
  );
  await step(R, "job detail", () => api.job(J));
  await step(R, "clock state", () => api.clockState(J));
  await step(R, "clock in", () => api.clockIn(J, ev()), (s) => (s.state === "CLOCKED_IN" ? null : `state ${s.state}`));
  await step(R, "break start", () => api.startBreak(J, ev()), (s) => (s.state === "ON_BREAK" ? null : `state ${s.state}`));
  await step(R, "break end", () => api.endBreak(J, ev()), (s) => (s.breaks.length === 1 && s.breaks[0].endedAt ? null : `breaks ${JSON.stringify(s.breaks)}`));
  const cl = await step(R, "checklist", () => api.checklist(J), (c) => (c.items.length > 0 ? null : "no items"));
  const item = cl?.items[0];
  if (item) await step(R, "checklist tick", () => api.setChecklistItem(J, item.id, true, randomUUID()), (i) => (i.done ? null : "not done"));
  const kr = await step(R, "kit report", () => api.kitReport(J));
  await step(R, "clock out (with kit report)", () =>
    api.clockOut(J, {
      ...ev(),
      report: {
        items: (kr?.items ?? []).map((k) =>
          k.kind === "COUNT"
            ? { productId: k.productId, kind: "COUNT" as const, quantity: Math.max(0, k.quantity - 1), status: "OK" as const }
            : k.kind === "LEVEL"
              ? { productId: k.productId, kind: "LEVEL" as const, levelStatus: "GOOD" as const }
              : { productId: k.productId, kind: "CONDITION" as const, condition: "AVAILABLE" as const },
        ),
      },
    }), (r) => JSON.stringify(r).includes("CLOCKED_OUT") || JSON.stringify(r).includes("DONE") ? null : `unexpected ${JSON.stringify(r).slice(0, 200)}`);

  const board = await step(R, "available board", () => api.availableJobs("all"), (b) => has(b.items.map((i) => i.id), w.jobs.open, "open job"));
  if (board) {
    await step(R, "available job detail", () => api.availableJob(w.jobs.open));
    await step(R, "claim", () => api.claimJob(w.jobs.open, randomUUID()));
  }

  const pay = await step(R, "pay summary", () => api.pay(), (x) => (x.balance.availableCents === 20000 ? null : `available ${x.balance.availableCents}`));
  await step(R, "payouts", () => api.payouts());
  let withdrawalCents: number | undefined;
  if (pay) {
    withdrawalCents = Math.max(pay.withdrawal.minimumCents, 5000);
    await step(R, "withdrawal request", () =>
      api.requestWithdrawal({ amountCents: withdrawalCents!, expectedFeeBasisPoints: pay.withdrawal.feeBasisPoints, note: "E2E test", clientEventId: randomUUID() }),
    );
    await step(R, "withdrawals list", () => api.withdrawals(), (l) => (l.items.length === 1 ? null : `${l.items.length} withdrawals`));
  }

  await step(R, "office chat summary", () => api.officeChat());
  await step(R, "office chat send", () => api.sendOfficeMessage({ body: "Running ten minutes late (E2E)", clientEventId: randomUUID() }));
  await step(R, "office chat read", () => api.officeMessages(), (m) => (m.items.some((x) => x.body.includes("E2E")) ? null : "sent message missing"));
  await step(R, "office chat mark read", () => api.markOfficeRead());

  const channels = await step(R, "team channels", () => api.teamChannels(), (c) => (c.items.length ? null : "no channels"));
  const ch = channels?.items[0]?.id;
  let teammateMsg: string | undefined;
  if (ch) {
    if (teammate) {
      const t = await step("teammate", "team chat send", () => teammate.api.sendTeamMessage(ch, { body: "Anyone have spare gloves? (E2E)", clientEventId: randomUUID() }));
      teammateMsg = t?.id;
    }
    const mine = await step(R, "team chat send", () => api.sendTeamMessage(ch, { body: "On my way (E2E)", clientEventId: randomUUID() }));
    await step(R, "team chat messages", () => api.teamMessages(ch), (m) => (mine && m.items.some((x) => x.id === mine.id) ? null : "own message missing"));
    if (mine) {
      await step(R, "team chat edit", () => api.editTeamMessage(ch, mine.id, { body: "On my way, 5 min (E2E)", clientEventId: randomUUID() }), (m) => (m.editedAt ? null : "no editedAt"));
      await step(R, "team chat delete", () => api.deleteTeamMessage(ch, mine.id));
    }
    if (teammateMsg) {
      await step(R, "team chat report", () => api.reportTeamMessage(teammateMsg!, { reason: "SPAM", note: "E2E test report", clientEventId: randomUUID() }));
      await step(R, "team chat block", () => api.blockPerson(w.users.teammate.id));
      await step(R, "team blocks list", () => api.teamBlocks());
      await step(R, "team chat unblock", () => api.unblockPerson(w.users.teammate.id));
    }
    await step(R, "team channel mark read", () => api.markChannelRead(ch));
  }

  const ann = await step(R, "announcements", () => api.announcements(), (a) => has(a.items.map((i) => i.id), w.announcementId, "announcement"));
  if (ann) {
    await step(R, "announcements mark read", () => api.markAnnouncementsRead({ ids: [w.announcementId] }));
    await step(R, "announcement react", () => api.setAnnouncementReaction(w.announcementId, { kind: "THUMBS_UP", clientEventId: randomUUID() }), (r) => (r.myReaction === "THUMBS_UP" ? null : `mine ${r.myReaction}`));
  }

  await step(R, "kit", () => api.kit(), (k) => (k.items.length ? null : "no kit"));
  const av = await step(R, "availability", () => api.availability());
  if (av) {
    await step(R, "availability set week", () =>
      api.setWeek({
        clientEventId: randomUUID(),
        days: (["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const).map((day) => ({
          day,
          available: day !== "SUNDAY",
          start: "08:00",
          end: "17:00",
        })),
      }),
    );
    const d = new Date(Date.now() + 20 * 24 * HOUR).toISOString().slice(0, 10);
    await step(R, "availability add day off", () => api.addDaysOff({ clientEventId: randomUUID(), from: d, to: d, reason: "E2E" }));
    await step(R, "availability remove day off", () => api.removeDaysOff(d, d));
  }

  await step(R, "training list", () => api.training(), (t) => has(t.items.map((i) => i.id), w.moduleId, "module"));
  const mod = await step(R, "training module", () => api.trainingModule(w.moduleId), (m) => (m.questions.length === 2 ? null : `${m.questions.length} questions`));
  await step(R, "training progress", () => api.setTrainingProgress(w.moduleId, { clientEventId: randomUUID(), videoProgress: 1, markComplete: true }));
  if (mod) {
    await step(R, "training quiz", () =>
      api.submitQuiz(w.moduleId, { clientEventId: randomUUID(), answers: [{ questionId: mod.questions[0].id, selectedIndex: 0 }, { questionId: mod.questions[1].id, selectedIndex: 1 }] }),
      (r) => (JSON.stringify(r).includes('"passed":true') ? null : `quiz ${JSON.stringify(r).slice(0, 200)}`),
    );
  }

  await step(R, "documents", () => api.documents(), (d) => has(d.items.map((i) => i.id), w.documentId, "document"));
  const doc = await step(R, "document detail", () => api.document(w.documentId));
  await step(R, "document access log", () => api.logDocumentAccess(w.documentId, { action: "OPEN" }));
  if (doc) {
    await step(R, "document sign (strokes)", () =>
      api.signDocument(w.documentId, {
        clientEventId: randomUUID(),
        agreed: true,
        version: doc.version,
        contentSha256: doc.contentSha256,
        signature: { width: 320, height: 120, strokes: [[[10, 60], [60, 20], [120, 90], [200, 40], [300, 70]], [[40, 100], [260, 100]]] },
      }),
      (d) => (JSON.stringify(d).includes("SIGNED") ? null : `status ${JSON.stringify(d).slice(0, 200)}`),
    );
  }

  await step(R, "strikes", () => api.strikes(), (s) => (s.activeCount >= 1 ? null : "no active strike"));
  await step(R, "deletion request state", () => api.deletionRequest());
  await step(R, "deletion request", () => api.requestDeletion({ reason: "E2E test, ignore", clientEventId: randomUUID() }));

  const token = `ExponentPushToken[e2e-${randomUUID().slice(0, 8)}]`;
  await step(R, "device register", () => api.registerDevice(token, "ios", APP_VERSION));
  await step(R, "device unregister", () => api.unregisterDevice(token));

  // The server clears the cookie with Max-Age=0, which the plugin stores as an
  // empty value: `better-auth.session_token=` is signed out.
  await step(R, "sign out", () => p.auth.client.signOut(), (r) => (r.error ? `${r.error.status} ${r.error.message}` : /session_token=[^;]/.test(p.auth.getCookie()) ? "session cookie kept" : null));
  await refused(R, "after sign-out, /me is 401", [401], () => api.me());
  return { withdrawalCents };
}

async function leadFlow(w: World): Promise<void> {
  const R = "field lead";
  const p = await signIn(R, w.users.lead.email);
  if (!p) return;
  const { api } = p;
  await step(R, "team today (own group only)", () => api.teamDay(), (d) =>
    d.scope !== "GROUP"
      ? `scope ${d.scope}`
      : (has(d.jobs.map((j) => j.id), w.jobs.mine, "group job") ?? (d.jobs.some((j) => j.id === w.jobs.outsider) ? "outsider's job shown" : null)),
  );
  await step(R, "approvals summary", () => api.approvalsSummary());
  await step(R, "time approvals list", () => api.timeItems("pending"), (l) => {
    const ids = l.items.map((i) => i.id);
    return has(ids, w.time.group, "group item") ?? (ids.includes(w.time.outsider) ? "outsider item shown" : ids.includes(w.time.lead) ? "own item shown" : null);
  });
  await step(R, "decide group time item", () => api.decideTime(w.time.group, { decision: "APPROVE", clientEventId: randomUUID() }));
  await refused(R, "decide own time item refused", [403, 404], () => api.decideTime(w.time.lead, { decision: "APPROVE", clientEventId: randomUUID() }));
  await step(R, "sign out", () => p.auth.client.signOut());
}

async function opsFlow(w: World): Promise<void> {
  const R = "ops manager";
  const p = await signIn(R, w.users.ops.email);
  if (!p) return;
  const { api } = p;
  await step(R, "team today (company)", () => api.teamDay(), (d) =>
    d.scope !== "COMPANY" ? `scope ${d.scope}` : (has(d.jobs.map((j) => j.id), w.jobs.outsider, "outsider job") ?? has(d.jobs.map((j) => j.id), w.jobs.mine, "cleaner job")),
  );
  const tomorrow = new Date(Date.now() + 26 * HOUR).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  await step(R, "schedule another day (own only)", () => api.teamDay(tomorrow), (d) =>
    d.scope !== "OWN" ? `scope ${d.scope}` : d.jobs.every((j) => j.id === w.jobs.tomorrow) ? null : "someone else's job shown",
  );
  await step(R, "manager job", () => api.managerJob(w.jobs.mineLater));
  const cands = await step(R, "crew candidates", () => api.crewCandidates(w.jobs.mineLater), (c) => has(c.candidates.map((x) => x.id), w.users.teammate.id, "teammate"));
  const mate = cands?.candidates.find((c) => c.id === w.users.teammate.id);
  if (mate) {
    await step(R, "add a cleaner to a job", () =>
      api.addCleaner(w.jobs.mineLater, {
        cleanerId: mate.id,
        acknowledgedWarningsHash: crewWarningsHash(mate.warnings.map((x) => ({ cleanerId: mate.id, code: x.code }))),
        clientEventId: randomUUID(),
      }),
    );
  }
  await step(R, "sign out", () => p.auth.client.signOut());
}

async function adminFlow(w: World): Promise<void> {
  const R = "admin";
  const p = await signIn(R, w.users.admin.email);
  if (!p) return;
  const { api } = p;
  await step(R, "/me", () => api.me(), (m) => (m.person.role === "ADMIN" ? null : `role ${m.person.role}`));
  await step(R, "team today", () => api.teamDay());
  await step(R, "approvals summary", () => api.approvalsSummary());
  await step(R, "time approvals list", () => api.timeItems("pending"), (l) => has(l.items.map((i) => i.id), w.time.outsider, "outsider item"));
  await step(R, "decide time (approve)", () => api.decideTime(w.time.outsider, { decision: "APPROVE", clientEventId: randomUUID() }));
  await step(R, "decide time (lead's, reject)", () => api.decideTime(w.time.lead, { decision: "REJECT", note: "E2E", clientEventId: randomUUID() }));

  const q = await step(R, "withdrawals queue", () => api.withdrawalsQueue("open"), (l) => (l.items.length === 1 ? null : `${l.items.length} open`));
  const wd = q?.items[0];
  if (wd) {
    await step(R, "withdrawal detail", () => api.withdrawal(wd.id));
    await step(R, "withdrawal approve", () => api.decideWithdrawal(wd.id, { action: "APPROVE", paymentMethod: "E_TRANSFER", clientEventId: randomUUID() }), (x) => (x.status === "APPROVED" ? null : `status ${x.status}`));
  }
  await step(R, "kit requests", () => api.kitRequests(), (l) => has(l.items.map((i) => i.id), w.kitRequestId, "kit request"));
  await step(R, "kit request approve", () => api.decideKitRequest(w.kitRequestId, { decision: "APPROVE", clientEventId: randomUUID() }));

  const convs = await step(R, "office inbox", () => api.officeConversations(), (c) => (c.items.length ? null : "empty inbox"));
  const conv = convs?.items[0];
  if (conv) {
    const cleanerId = JSON.stringify(conv).includes(w.users.cleaner.id) ? w.users.cleaner.id : undefined;
    if (!cleanerId) rows.push({ role: R, step: "office inbox has the cleaner", ok: false, detail: JSON.stringify(conv).slice(0, 200) });
    else {
      await step(R, "office conversation", () => api.conversationMessages(cleanerId), (m) => (m.items.length ? null : "no messages"));
      await step(R, "office reply", () => api.replyAsOffice(cleanerId, { body: "Thanks, noted (E2E)", clientEventId: randomUUID() }));
      await step(R, "office mark read", () => api.markConversationRead(cleanerId));
    }
  }

  const al = await step(R, "alerts", () => api.alerts(), (a) => (a.items.length ? null : "no alerts"));
  if (al?.items.length) await step(R, "alerts mark read", () => api.markAlertsRead({ ids: al.items.map((a) => a.id) }), (r) => (r.unreadCount === 0 ? null : `unread ${r.unreadCount}`));
  await step(R, "late arrivals", () => api.lateArrivals());
  await step(R, "issues", () => api.issues("open"), (l) => has(l.items.map((i) => i.id), w.issueId, "issue"));
  await step(R, "issue resolve", () => api.setIssueStatus(w.issueId, { status: "RESOLVED", resolutionNote: "Plumber booked (E2E)", clientEventId: randomUUID() }));

  const job = await step(R, "manager job (crew)", () => api.managerJob(w.jobs.outsider));
  const cands = await step(R, "crew candidates", () => api.crewCandidates(w.jobs.outsider));
  if (job && cands) {
    const crew = [w.users.outsider.id];
    const adding = cands.candidates.filter((c) => c.id === w.users.teammate.id);
    await step(R, "crew change", () =>
      api.setCrew(w.jobs.outsider, {
        cleanerIds: [...crew, w.users.teammate.id],
        expectedCrewIds: crew,
        acknowledgedWarningsHash: crewWarningsHash(adding.flatMap((c) => c.warnings.map((x) => ({ cleanerId: c.id, code: x.code })))),
        clientEventId: randomUUID(),
      }),
    );
  }

  const channels = await step(R, "team channels", () => api.teamChannels());
  const ch = channels?.items[0]?.id;
  if (ch) {
    const msgs = await step(R, "team messages", () => api.teamMessages(ch));
    const target = msgs?.items.find((m) => !m.fromMe && !m.deleted && m.body?.includes("gloves"));
    if (target) await step(R, "moderation delete", () => api.moderateTeamMessage(ch, target.id));
    else rows.push({ role: R, step: "moderation delete", ok: false, detail: "no teammate message to moderate" });
  }
  await step(R, "sign out", () => p.auth.client.signOut());
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function main() {
  const db = openDb();
  if (CLEANUP_ONLY) {
    await removeCompany(db);
    console.log(`removed ${SLUG}`);
    await db.$disconnect();
    return;
  }
  let world: World | undefined;
  try {
    await step("setup", "server meta", () => platform.meta());
    world = await createCompany(db);
    console.log(`company ${SLUG} (${world.orgId}) at ${COMPANY_ORIGIN}`);
    const teammate = await signIn("teammate", world.users.teammate.email);
    await cleanerFlow(world, teammate);
    await leadFlow(world);
    await opsFlow(world);
    await adminFlow(world);
    if (teammate) await teammate.auth.client.signOut();
  } finally {
    if (!KEEP) {
      await removeCompany(db);
      console.log(`removed ${SLUG}`);
    } else console.log(`kept ${SLUG}; remove with --cleanup`);
    await db.$disconnect();
  }

  console.log("\n| role | pass | fail |\n|---|---|---|");
  for (const role of [...new Set(rows.map((r) => r.role))]) {
    const mine = rows.filter((r) => r.role === role);
    console.log(`| ${role} | ${mine.filter((r) => r.ok).length} | ${mine.filter((r) => !r.ok).length} |`);
  }
  const failed = rows.filter((r) => !r.ok);
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`- [${f.role}] ${f.step}: ${f.detail}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
