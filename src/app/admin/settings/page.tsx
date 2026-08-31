import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import SettingsClient from "./SettingsClient";
import { seedNotificationCatalog } from "@/lib/notifications";
import { requireStaff } from "@/lib/page-guards";
import { getBudgetCategoryOptions } from "@/lib/budget-categories";
import type { SettingsSectionFailure, SettingsUser } from "./types";

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

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <SettingsClient
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
