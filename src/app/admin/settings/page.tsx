import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import SettingsClient from "./SettingsClient";
import { twilioConnectionStatus } from "@/lib/twilio-org";
import { canStoreSecrets } from "@/lib/secret-box";
import { getSetting } from "@/lib/settings";
import { platformDb } from "@/lib/platform-db";
import { cleanerSeatUsage } from "@/lib/plan-limits";
import { reconcileSubscriptionFromStripe } from "@/lib/billing";
import {
  ANNUAL_MONTHS_SAVED,
  PLANS,
  effectiveMonthlyFor,
  priceFor,
  trialEndFrom,
} from "@/lib/plans";
import type { OrgPlan } from "@prisma/client";
import { currentAppUrl } from "@/lib/org-url";
import { requireOrgId } from "@/lib/org";
import { seedNotificationCatalog } from "@/lib/notifications";
import { requireStaff } from "@/lib/page-guards";
import { getBudgetCategoryOptions } from "@/lib/budget-categories";
import type { SettingsSectionFailure, SettingsUser } from "./types";
import { listProxyNumbers, type ProxyNumberRow } from "../actions/proxyNumbers";

// Allow bulk CSV import (processed by the importCsv server action) enough time.
export const maxDuration = 60;

/**
 * How far back the Budgets tab's transaction feed reaches, and how many rows it
 * will carry at most.
 *
 * This read used to be unbounded — every Transaction row ever written, with its
 * job joined on — on a page that already runs a dozen other queries against a
 * pooler measured at 1.5–4.5 s each (scripts/probe-pricing-fixes.ts). It is the
 * one query here whose cost grows without limit as the business runs, so it is
 * the one that eventually pushes the page past `maxDuration` or past the
 * response size limit. Bounding it now costs nothing: the tab groups by month
 * and its period picker only ever offered months it could see.
 *
 * CONSEQUENCE, deliberate: Settings → Budgets shows the last 12 months.
 * /admin/finances keeps the full history — its own read is still unbounded and
 * is out of scope for this change, but it carries the same latent problem.
 */
const BUDGET_TX_MONTHS = 12;
const BUDGET_TX_MAX_ROWS = 2000;

/**
 * One section's data, loaded so that its failure cannot take the page with it.
 *
 * The thirteen reads below used to sit in a bare `Promise.all`, where a single
 * rejection threw the whole render — one unreachable table and the admin got
 * Next's bare error screen for the ENTIRE settings area, which is exactly what
 * a client reports as "the settings page returns an error". Now a failed
 * section degrades to its empty state, names itself in `failures`, and every
 * other tab still works.
 *
 * Still parallel: each call starts before any is awaited, so this costs no
 * extra latency over the `Promise.all` it replaces.
 */
async function settledSection<T>(
  key: string,
  label: string,
  run: () => Promise<T>,
  fallback: T,
  failures: SettingsSectionFailure[]
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`[settings] section "${key}" failed to load`, error);
    failures.push({ key, label });
    return fallback;
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  /**
   * `?tab=` — which tab to open on. Resolved in SettingsClient against its own
   * TAB list (an unknown id, or an admin-only tab asked for by somebody who is
   * not an admin, falls back to Profile), so nothing here has to be trusted.
   * Read on the server rather than with useSearchParams so the right tab is in
   * the first paint and no Suspense boundary is needed.
   */
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tabParam = (await searchParams)?.tab;
  const initialTab = typeof tabParam === "string" ? tabParam : undefined;

  // ONE shared page for every staff role (decision D6). `SettingsClient` has
  // always rendered role-appropriate tabs — `adminOnly: true` tab defs plus the
  // `isAdmin` prop — and the cleaner route re-exports this file, so the guard
  // has to be the staff guard. It was `requireOwnerAdmin()`, which redirected
  // every EMPLOYEE, OPS_MANAGER and FIELD_LEAD away from their own profile,
  // password, availability and notification preferences: 39 live staff accounts
  // at the time of writing (scripts/probe-pricing-fixes.ts). CLIENTs are still
  // bounced, and every admin-only section stays behind `isAdmin` below — the
  // non-admin payload is empty arrays, so nothing privileged is even fetched.
  const session = await requireStaff();

  const sessionUser = session.user as typeof session.user & { role?: string };

  const dbUser = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
    },
  });

  if (!dbUser) {
    redirect("/sign-in");
  }

  const userWithRole: SettingsUser = {
    ...sessionUser,
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    phone: dbUser.phone,
    role: dbUser.role as SettingsUser["role"],
  };
  // ADMIN CONFIGURATION, not "can open the page". OPS_MANAGER and FIELD_LEAD
  // reach Settings for their own account and see Profile + Availability only.
  const isAdmin =
    userWithRole.role === "OWNER" || userWithRole.role === "ADMIN";

  // Sections that could not be loaded. Rendered as an inline error on the tabs
  // that depend on them instead of throwing the page.
  const failures: SettingsSectionFailure[] = [];

  const budgetTxSince = new Date();
  budgetTxSince.setMonth(budgetTxSince.getMonth() - BUDGET_TX_MONTHS);

  // Fetch all settings data in parallel (admin only).
  const [
    appSettings,
    products,
    kitTemplates,
    suppliers,
    inventoryLocations,
    checklistTemplates,
    trainingModules,
    documents,
    users,
    serviceAreas,
    transactions,
    budgets,
    budgetCategories,
  ] = isAdmin
    ? await Promise.all([
        settledSection("appSettings", "Application settings", () => db.appSetting.findMany(), [], failures),
        settledSection(
          "products",
          "Products",
          () => db.product.findMany({ orderBy: { name: "asc" } }),
          [],
          failures
        ),
        settledSection(
          "kitTemplates",
          "Kit templates",
          () =>
            db.kitTemplate.findMany({
              include: {
                items: { include: { product: true } },
              },
              orderBy: { name: "asc" },
            }),
          [],
          failures
        ),
        settledSection(
          "suppliers",
          "Suppliers",
          () =>
            db.supplier.findMany({
              include: {
                prices: { include: { product: true } },
              },
              orderBy: { name: "asc" },
            }),
          [],
          failures
        ),
        settledSection(
          "inventoryLocations",
          "Inventory locations",
          () =>
            db.inventoryLocation.findMany({
              include: { stock: true },
              orderBy: { name: "asc" },
            }),
          [],
          failures
        ),
        settledSection(
          "checklistTemplates",
          "Checklist templates",
          () =>
            db.checklistTemplate.findMany({
              include: {
                items: { orderBy: { sortOrder: "asc" } },
                // Stage 10 — the customer scope chip ("Mckiernan — 12 Main
                // St"). Joined here rather than resolved in the client so the
                // list is correct on first paint and stays correct even if the
                // lazy picker load in `getChecklistScopeOptions` never runs.
                client: { select: { id: true, name: true } },
                clientAddress: { select: { id: true, label: true, address: true } },
              },
              orderBy: { name: "asc" },
            }),
          [],
          failures
        ),
        settledSection(
          "trainingModules",
          "Training modules",
          () =>
            db.trainingModule.findMany({
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              include: {
                quizzes: { orderBy: { sortOrder: "asc" } },
                progress: {
                  include: {
                    employee: { select: { id: true, name: true } },
                  },
                },
              },
            }),
          [],
          failures
        ),
        settledSection(
          "documents",
          "Documents",
          () =>
            db.document.findMany({
              orderBy: { createdAt: "desc" },
              include: {
                signatures: {
                  include: {
                    employee: { select: { id: true, name: true } },
                  },
                  orderBy: { createdAt: "asc" },
                },
              },
            }),
          [],
          failures
        ),
        // Feeds the Documents tab's "Specific users" assignment picker. Staff
        // only — imported customers get a CLIENT-role User row and must never
        // be offered as document signers.
        settledSection(
          "users",
          "Staff list",
          () =>
            db.user.findMany({
              where: { role: { not: "CLIENT" }, deletedAt: null },
              orderBy: { name: "asc" },
              select: { id: true, name: true, role: true },
            }),
          [],
          failures
        ),
        settledSection(
          "serviceAreas",
          "Service areas",
          () => db.serviceArea.findMany({ orderBy: { prefix: "asc" } }),
          [],
          failures
        ),
        settledSection(
          "transactions",
          "Recent transactions",
          () =>
            db.transaction.findMany({
              // Bounded — see BUDGET_TX_MONTHS above.
              where: { date: { gte: budgetTxSince } },
              orderBy: { date: "desc" },
              take: BUDGET_TX_MAX_ROWS,
              include: { job: { select: { id: true, clientName: true } } },
            }),
          [],
          failures
        ),
        settledSection(
          "budgets",
          "Budgets",
          () =>
            db.budget.findMany({
              orderBy: [{ period: "desc" }, { category: { sortOrder: "asc" } }],
            }),
          [],
          failures
        ),
        settledSection(
          "budgetCategories",
          "Budget categories",
          () => getBudgetCategoryOptions(),
          [],
          failures
        ),
      ])
    : [[], [], [], [], [], [], [], [], [], [], [], [], []];

  // Notification catalog — auto-seed on first admin visit, then load.
  //
  // The seed already had its own try/catch and its own `count === 0` gate; what
  // it did not have was protection for the count and the load AROUND it. Those
  // two ran bare, so an unreachable `notification_setting` table threw the page
  // rather than emptying one tab. Both are now inside the same degrade path as
  // everything above, and a seed failure leaves the catalog empty instead of
  // half-written.
  let notificationSettings: Array<{
    id: string;
    recipient: "ADMIN" | "CUSTOMER" | "PROVIDER";
    category: string;
    key: string;
    label: string;
    trigger: string;
    channel: "EMAIL" | "SMS" | "APP_PUSH";
    enabled: boolean;
    isProposed: boolean;
    sortOrder: number;
  }> = [];
  if (isAdmin) {
    notificationSettings = await settledSection(
      "notificationSettings",
      "Notification catalog",
      async () => {
        const existingCount = await db.notificationSetting.count();
        if (existingCount === 0) {
          try {
            await seedNotificationCatalog();
          } catch (e) {
            console.error("Failed to seed notification catalog", e);
          }
        }
        return db.notificationSetting.findMany({
          orderBy: [{ recipient: "asc" }, { sortOrder: "asc" }],
        });
      },
      [],
      failures
    );
  }

  // Budget editor data (mirrors the finances page serialization).
  const txRows = transactions.map((t) => ({
    id: t.id,
    date: t.date.toISOString(),
    categoryId: t.categoryId,
    amount: t.amount,
    description: t.description,
    notes: t.notes,
    jobId: t.jobId,
    jobClientName: t.job?.clientName ?? null,
    source: t.source,
    taxAmount: t.taxAmount,
    isAuto: t.isAuto,
  }));
  const budgetRows = budgets.map((b) => ({
    id: b.id,
    categoryId: b.categoryId,
    period: b.period,
    amount: b.amount,
    notes: b.notes,
  }));

  // Connector status. Read here rather than in the client so the page shows
  // what is true right now, and degrades to "not set up" rather than erroring
  // if the platform database is unreachable.
  const orgId = await requireOrgId();
  const twilioStatus = await twilioConnectionStatus(orgId)
    .then((t) => ({ ...t, connectedAt: t.connectedAt?.toISOString() ?? null }))
    .catch(() => ({
      connected: false,
      accountSid: null,
      tokenHint: null,
      connectedAt: null,
      unreadable: false,
      usingPlatform: false,
      smsNumber: null,
      // Read straight from the environment rather than defaulted: it is the
      // one field here that does not come from the platform database, so an
      // unreachable database is no reason to guess at it — and guessing wrong
      // either hides the "cannot store credentials" warning or invents it.
      canStoreSecrets: canStoreSecrets(),
    }));
  const twilioForwardUrl = await getSetting("sms.forwardInboundUrl").catch(() => "");
  const appUrl = await currentAppUrl();
  const twilioWebhookUrl = `${appUrl}/api/twilio/inbound`;
  // Both legs of a masked number, because a pooled number needs the pair.
  const twilioVoiceWebhookUrl = `${appUrl}/api/twilio/voice`;

  // The masked-number pool. Loaded here rather than in the tab so an
  // unreachable table names itself under `failures` — an empty list on the
  // Connectors tab reads as "my numbers are gone", which is a worse lie than
  // "this section could not be loaded".
  let proxyNumbers: ProxyNumberRow[] = [];
  if (isAdmin) {
    proxyNumbers = await settledSection(
      "proxyNumbers",
      "Masked numbers",
      async () => {
        // The action reports failure instead of throwing, because its other
        // caller is a button. Here it has to reach the degrade path.
        const res = await listProxyNumbers();
        if (!res.ok) throw new Error(res.message);
        return res.numbers;
      },
      [],
      failures
    );
  }

  // Plan and billing. Read straight from the platform rather than cached, so a
  // card added a moment ago on Stripe is reflected the next time this loads.
  //
  // Reconciled against Stripe first, because the row only learns its
  // subscription id from a webhook and a missing webhook made this panel tell
  // a workspace that had already paid three times that it had "No card on
  // file". Never allowed to break the page: if Stripe cannot be reached the
  // row is shown as it stands.
  const [subscription, seats] = await Promise.all([
    reconcileSubscriptionFromStripe(orgId)
      .catch(() => {})
      .then(() =>
        platformDb.subscription.findUnique({
          where: { organizationId: orgId },
          select: {
            plan: true,
            status: true,
            interval: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            stripeSubscriptionId: true,
            stripeCustomerId: true,
          },
        }),
      )
      .catch(() => null),
    cleanerSeatUsage().catch(() => null),
  ]);

  const plans = (Object.keys(PLANS) as OrgPlan[]).map((key) => ({
    key,
    label: PLANS[key].label,
    monthlyUsd: priceFor(key, "MONTHLY"),
    annualUsd: priceFor(key, "ANNUAL"),
    annualPerMonth: effectiveMonthlyFor(key, "ANNUAL"),
    highlights: PLANS[key].highlights,
    selfServe: PLANS[key].selfServe,
  }));

  const planStatus = {
    plan: subscription?.plan ?? "STARTER",
    status: subscription?.status ?? "TRIALING",
    interval: subscription?.interval ?? "MONTHLY",
    // A workspace provisioned before subscriptions existed has no row; show a
    // trial from today rather than an empty panel that looks broken.
    trialEndsAt: (subscription?.trialEndsAt ?? trialEndFrom(new Date())).toISOString(),
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    paying: Boolean(subscription?.stripeSubscriptionId),
    // The billing portal belongs to the CUSTOMER, not to the subscription, so
    // it is reachable as soon as this workspace has one — including when our
    // own subscription id was never written. That button being keyed off the
    // id is why the only way to the portal was around the app.
    canManageBilling: Boolean(subscription?.stripeCustomerId),
    cleanersUsed: seats?.used ?? 0,
    cleanerLimit: seats?.limit ?? null,
    monthsSaved: ANNUAL_MONTHS_SAVED,
  };

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <SettingsClient
        twilio={{ ...twilioStatus, forwardUrl: twilioForwardUrl }}
        twilioWebhookUrl={twilioWebhookUrl}
        twilioVoiceWebhookUrl={twilioVoiceWebhookUrl}
        proxyNumbers={proxyNumbers}
        plans={plans}
        planStatus={planStatus}
        user={userWithRole}
        isAdmin={isAdmin}
        initialTab={initialTab}
        appSettings={appSettings as never}
        products={products as never}
        kitTemplates={kitTemplates as never}
        suppliers={suppliers as never}
        inventoryLocations={inventoryLocations as never}
        checklistTemplates={checklistTemplates as never}
        trainingModules={trainingModules as never}
        documents={documents as never}
        users={users as never}
        serviceAreas={serviceAreas as never}
        notificationSettings={notificationSettings}
        transactions={txRows}
        budgets={budgetRows}
        budgetCategories={budgetCategories}
        failedSections={failures}
      />
    </div>
  );
}
