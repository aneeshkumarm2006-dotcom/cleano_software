/**
 * Everything the Awer console reads.
 *
 * This is the only module besides platform-db.ts that is allowed to see across
 * organizations, and it is read-only. It exists so the console's pages never
 * touch `platformDb` directly: one place to audit, one place where the
 * cross-tenant queries live.
 *
 * Shape of every function here: a handful of grouped queries, then assembled in
 * memory. Never one query per workspace -- the console is opened between other
 * jobs and must stay fast as the customer list grows.
 */
import "server-only";

import { cache } from "react";

import type { OrgPlan, OrgStatus, SubscriptionStatus } from "@prisma/client";

import { platformDb } from "@/lib/platform-db";
import { CLEANER_SEAT_WHERE } from "@/lib/seat-rules";
import { PLANS, cleanerLimitFor } from "@/lib/plans";
import { PLATFORM_ORG_SLUG } from "@/lib/tenant";

/** Jobs "recently" means the last 30 days everywhere in the console. */
export const WINDOW_DAYS = 30;

function windowStart(days = WINDOW_DAYS): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export type SubscriptionSummary = {
  status: SubscriptionStatus;
  plan: OrgPlan;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  seats: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

export type WorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  status: OrgStatus;
  plan: OrgPlan;
  timezone: string;
  createdAt: Date;
  subscription: SubscriptionSummary | null;

  cleaners: number;
  /** Seat cap in force: the sold seat count, else the plan default. NULL = uncapped. */
  seatLimit: number | null;
  clients: number;
  jobs30d: number;

  owner: { name: string; email: string } | null;
  lastActiveAt: Date | null;

  /**
   * What this workspace bills per month, or NULL when there is no list price.
   *
   * NULL is not zero. The Organization tier is quoted per deal and that number
   * lives in Stripe, not here, so the console shows a dash rather than inventing
   * a figure and quietly under-reporting revenue.
   */
  monthlyUsd: number | null;
  /** Counted toward MRR only when the money is actually being collected. */
  billing: "paying" | "trialing" | "past_due" | "not_billed";
};

/**
 * The workspaces Awer operates. Excludes Awer's own platform workspace.
 *
 * Cached per request: the rail wants counts, the page wants the table, and the
 * attention queue is derived from the same rows. One set of queries serves all
 * three rather than three sets that could disagree with each other.
 */
export const listWorkspaces = cache(async (): Promise<WorkspaceRow[]> => {
  const since = windowStart();

  const orgs = await platformDb.organization.findMany({
    where: { slug: { not: PLATFORM_ORG_SLUG } },
    include: {
      subscription: {
        select: {
          status: true,
          plan: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          seats: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
  if (orgs.length === 0) return [];

  const ids = orgs.map((o) => o.id);

  // Four grouped queries, not four per workspace.
  const [cleaners, clients, jobs, seen, owners] = await Promise.all([
    platformDb.user.groupBy({
      by: ["organizationId"],
      // Same definition of "a cleaner seat" the app enforces with, imported
      // rather than restated, so the number here is the number that blocks.
      where: { organizationId: { in: ids }, ...CLEANER_SEAT_WHERE },
      _count: { _all: true },
    }),
    platformDb.client.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    platformDb.job.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids }, deletedAt: null, startTime: { gte: since } },
      _count: { _all: true },
    }),
    platformDb.user.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids }, deletedAt: null },
      _max: { lastSeenAt: true },
    }),
    // One owner per workspace is the normal case; taking the earliest keeps the
    // answer stable when a company has promoted a second owner.
    platformDb.user.findMany({
      where: { organizationId: { in: ids }, role: "OWNER", deletedAt: null },
      select: { organizationId: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const countOf = (
    rows: { organizationId: string; _count: { _all: number } }[],
  ): Map<string, number> => new Map(rows.map((r) => [r.organizationId, r._count._all]));

  const cleanerBy = countOf(cleaners);
  const clientBy = countOf(clients);
  const jobBy = countOf(jobs);
  const seenBy = new Map(seen.map((r) => [r.organizationId, r._max.lastSeenAt]));
  const ownerBy = new Map<string, { name: string; email: string }>();
  for (const o of owners) {
    if (!ownerBy.has(o.organizationId)) {
      ownerBy.set(o.organizationId, { name: o.name, email: o.email });
    }
  }

  return orgs.map((o) => {
    const sub = o.subscription;
    const plan = sub?.plan ?? o.plan;
    const listPrice = PLANS[plan].monthlyUsd;

    const billing: WorkspaceRow["billing"] =
      o.status !== "ACTIVE"
        ? "not_billed"
        : sub?.status === "TRIALING"
          ? "trialing"
          : sub?.status === "PAST_DUE"
            ? "past_due"
            : sub?.status === "ACTIVE"
              ? "paying"
              : "not_billed";

    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      status: o.status,
      plan,
      timezone: o.timezone,
      createdAt: o.createdAt,
      subscription: sub ?? null,
      cleaners: cleanerBy.get(o.id) ?? 0,
      seatLimit: cleanerLimitFor(plan, sub?.seats ?? null),
      clients: clientBy.get(o.id) ?? 0,
      jobs30d: jobBy.get(o.id) ?? 0,
      owner: ownerBy.get(o.id) ?? null,
      lastActiveAt: seenBy.get(o.id) ?? null,
      monthlyUsd: listPrice,
      billing,
    };
  });
});

export async function getWorkspace(slug: string): Promise<WorkspaceRow | null> {
  const all = await listWorkspaces();
  return all.find((w) => w.slug === slug) ?? null;
}

/**
 * Detail only the workspace page needs, kept out of the list query so the list
 * stays cheap.
 */
export type WorkspaceDetail = {
  admins: number;
  jobsAllTime: number;
  jobsCompleted30d: number;
  revenue30d: number;
  firstJobAt: Date | null;
  lastJobAt: Date | null;
  /** They have set their own business name, rather than running on the default. */
  hasOwnName: boolean;
};

export async function getWorkspaceDetail(orgId: string): Promise<WorkspaceDetail> {
  const since = windowStart();

  const [admins, jobsAllTime, completed, first, last, branding] = await Promise.all([
    platformDb.user.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        isActive: true,
        role: { in: ["OWNER", "ADMIN", "OPS_MANAGER"] },
      },
    }),
    platformDb.job.count({ where: { organizationId: orgId, deletedAt: null } }),
    platformDb.job.aggregate({
      where: {
        organizationId: orgId,
        deletedAt: null,
        startTime: { gte: since },
        status: { in: ["COMPLETED", "PAID"] },
      },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    platformDb.job.findFirst({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { startTime: "asc" },
      select: { startTime: true },
    }),
    platformDb.job.findFirst({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { startTime: "desc" },
      select: { startTime: true },
    }),
    platformDb.appSetting.findFirst({
      where: { organizationId: orgId, key: "general.businessName" },
      select: { id: true },
    }),
  ]);

  return {
    admins,
    jobsAllTime,
    jobsCompleted30d: completed._count._all,
    revenue30d: completed._sum.totalAmount ?? 0,
    firstJobAt: first?.startTime ?? null,
    lastJobAt: last?.startTime ?? null,
    hasOwnName: branding != null,
  };
}

/**
 * Setup progress for a workspace: the five things a new company has to do
 * before the product is actually working for them.
 */
export function setupSteps(w: WorkspaceRow, d: WorkspaceDetail) {
  return [
    { label: "Cleaners added", done: w.cleaners > 0 },
    { label: "Customers on file", done: w.clients > 0 },
    { label: "First job booked", done: d.jobsAllTime > 0 },
    { label: "Card on file", done: w.subscription?.stripeCustomerId != null },
    { label: "Business name set", done: d.hasOwnName },
  ];
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type AttentionItem = {
  severity: "high" | "medium" | "low";
  slug: string;
  title: string;
  detail: string;
};

/**
 * What needs a human today, most urgent first.
 *
 * Derived, never stored: every rule here reads from the same workspace rows the
 * list page shows, so the queue can never disagree with the table.
 */
export function attentionQueue(rows: WorkspaceRow[]): AttentionItem[] {
  const out: AttentionItem[] = [];
  const now = Date.now();
  const days = (d: Date) => Math.ceil((d.getTime() - now) / 86_400_000);

  for (const w of rows) {
    if (w.status === "SUSPENDED") {
      out.push({
        severity: "high",
        slug: w.slug,
        title: `${w.name} is suspended`,
        detail: `${w.cleaners} cleaners are locked out. Nothing was deleted.`,
      });
      continue;
    }
    // A live workspace with no subscription row at all. Provisioning always
    // creates one, so this means something went wrong on the way in -- and
    // without it the workspace is billed for nothing, has no plan to enforce and
    // no trial to expire. It would otherwise sit here looking healthy forever,
    // because every other rule below reads the subscription it does not have.
    if (w.status === "ACTIVE" && !w.subscription) {
      out.push({
        severity: "high",
        slug: w.slug,
        title: `${w.name} has no subscription`,
        detail: "Nothing to bill and no plan to enforce. It was not provisioned normally.",
      });
      continue;
    }
    if (w.subscription?.status === "PAST_DUE") {
      out.push({
        severity: "high",
        slug: w.slug,
        title: `${w.name} — payment failed`,
        detail: "Reach the owner before the workspace suspends itself.",
      });
    }
    if (w.subscription?.status === "TRIALING" && w.subscription.trialEndsAt) {
      const left = days(w.subscription.trialEndsAt);
      if (left <= 7) {
        out.push({
          severity: left <= 3 ? "high" : "medium",
          slug: w.slug,
          title: `${w.name} — trial ends in ${Math.max(left, 0)} day${left === 1 ? "" : "s"}`,
          detail: w.subscription.stripeCustomerId
            ? "A card is on file; it should convert on its own."
            : "No card on file — this will not convert on its own.",
        });
      }
    }
    if (w.seatLimit != null && w.cleaners >= w.seatLimit) {
      out.push({
        severity: "medium",
        slug: w.slug,
        title: `${w.name} — every cleaner seat is used`,
        detail: `${w.cleaners} of ${w.seatLimit} on ${PLANS[w.plan].label}. They cannot add anyone else.`,
      });
    } else if (w.seatLimit != null && w.cleaners >= w.seatLimit - 1 && w.cleaners > 0) {
      out.push({
        severity: "low",
        slug: w.slug,
        title: `${w.name} — one cleaner seat left`,
        detail: `${w.cleaners} of ${w.seatLimit} on ${PLANS[w.plan].label}.`,
      });
    }
    if (w.status === "ACTIVE" && w.jobs30d === 0 && w.cleaners > 0) {
      out.push({
        severity: "low",
        slug: w.slug,
        title: `${w.name} — no jobs booked in ${WINDOW_DAYS} days`,
        detail: `${w.cleaners} cleaners on the account and nothing scheduled.`,
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export type OverviewStats = {
  total: number;
  paying: number;
  trialing: number;
  pastDue: number;
  suspended: number;
  mrr: number;
  /** Workspaces whose price is negotiated, so their revenue is not in `mrr`. */
  quoted: number;
  cleaners: number;
  clients: number;
  jobs30d: number;
  newThisMonth: WorkspaceRow[];
};

export function overviewStats(rows: WorkspaceRow[]): OverviewStats {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  let mrr = 0;
  let quoted = 0;
  for (const w of rows) {
    if (w.billing !== "paying" && w.billing !== "past_due") continue;
    if (w.monthlyUsd == null) quoted += 1;
    else mrr += w.monthlyUsd;
  }

  return {
    total: rows.length,
    paying: rows.filter((w) => w.billing === "paying").length,
    trialing: rows.filter((w) => w.billing === "trialing").length,
    pastDue: rows.filter((w) => w.billing === "past_due").length,
    suspended: rows.filter((w) => w.status === "SUSPENDED").length,
    mrr,
    quoted,
    cleaners: rows.reduce((n, w) => n + w.cleaners, 0),
    clients: rows.reduce((n, w) => n + w.clients, 0),
    jobs30d: rows.reduce((n, w) => n + w.jobs30d, 0),
    newThisMonth: rows
      .filter((w) => w.createdAt >= monthStart)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}

// ---------------------------------------------------------------------------
// Audit, staff, health
// ---------------------------------------------------------------------------

export async function recentAudit(limit = 100, action?: string) {
  return platformDb.platformAuditLog.findMany({
    where: action ? { action: { startsWith: action } } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function auditForOrg(orgId: string, limit = 12) {
  return platformDb.platformAuditLog.findMany({
    where: { targetOrgId: orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export const listStaff = cache(async () => {
  return platformDb.user.findMany({
    where: { platformRole: { not: null }, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
      isActive: true,
      lastSeenAt: true,
      createdAt: true,
    },
    orderBy: [{ platformRole: "desc" }, { name: "asc" }],
  });
});

/**
 * Companies asking for the Organization tier.
 *
 * Waiting ones first and oldest first inside that, because the cost of this
 * queue is somebody sitting unanswered — sorting by newest would bury exactly
 * the request that has been ignored longest.
 */
export const listAccessRequests = cache(async () => {
  const rows = await platformDb.accessRequest.findMany({
    orderBy: { createdAt: "asc" },
  });
  const rank = { PENDING: 0, APPROVED: 1, DECLINED: 2 } as const;
  return rows.sort((a, b) => rank[a.status] - rank[b.status]);
});

export type IsolationCheck = { label: string; ok: boolean; detail: string };

/**
 * The isolation guarantees, read back from the database rather than asserted.
 *
 * Everything here is a live catalog query. A panel that says "row-level security
 * is on" because someone typed that into a template is worse than no panel at
 * all, so each line is something Postgres itself reports.
 */
export async function isolationChecks(): Promise<IsolationCheck[]> {
  type CountRow = { n: bigint };

  const [rls, forced, unscopedUsers, unscopedJobs, orgCount] = await Promise.all([
    platformDb.$queryRaw<CountRow[]>`
      SELECT count(*)::bigint AS n
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`,
    platformDb.$queryRaw<CountRow[]>`
      SELECT count(*)::bigint AS n
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity`,
    platformDb.user.count({ where: { organizationId: "" } }),
    platformDb.job.count({ where: { organizationId: "" } }),
    platformDb.organization.count(),
  ]);

  const rlsN = Number(rls[0]?.n ?? 0);
  const forcedN = Number(forced[0]?.n ?? 0);

  return [
    {
      label: "Row-level security enabled",
      ok: rlsN > 0,
      detail: `${rlsN} tables`,
    },
    {
      label: "Policies apply to the table owner too",
      ok: forcedN > 0 && forcedN === rlsN,
      detail: forcedN === rlsN ? `${forcedN} tables forced` : `${forcedN} of ${rlsN} forced`,
    },
    {
      label: "No user rows without an organization",
      ok: unscopedUsers === 0,
      detail: unscopedUsers === 0 ? "none found" : `${unscopedUsers} rows`,
    },
    {
      label: "No job rows without an organization",
      ok: unscopedJobs === 0,
      detail: unscopedJobs === 0 ? "none found" : `${unscopedJobs} rows`,
    },
    {
      label: "Organizations on record",
      ok: orgCount > 0,
      detail: `${orgCount} including Awer's own`,
    },
  ];
}
