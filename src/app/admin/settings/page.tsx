import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import SettingsClient from "./SettingsClient";
import { seedNotificationCatalog } from "@/lib/notifications";
import { requireOwnerAdmin } from "@/lib/page-guards";

// Allow bulk CSV import (processed by the importCsv server action) enough time.
export const maxDuration = 60;

export default async function SettingsPage() {
  // OWNER/ADMIN only. This page had NO role check at all — just a session — so
  // although its Sidebar entry has always carried `adminOnly: true` and was
  // correctly hidden, an OPS_MANAGER or FIELD_LEAD reached the whole thing by
  // typing the URL: pricing rules, the GST/QST tax config, the notification
  // catalog, service content, FAQ content and CSV import. The nav flag and the
  // server now agree.
  await requireOwnerAdmin();

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const sessionUser = session.user as typeof session.user & {
    role: "OWNER" | "ADMIN" | "EMPLOYEE";
  };

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

  const userWithRole = {
    ...sessionUser,
    name: dbUser.name,
    email: dbUser.email,
    phone: dbUser.phone,
    role: dbUser.role as "OWNER" | "ADMIN" | "EMPLOYEE",
  };
  const isAdmin =
    userWithRole.role === "OWNER" || userWithRole.role === "ADMIN";

  // Fetch all settings data in parallel (admin only)
  const [
    appSettings,
    products,
    kitTemplates,
    inventoryRules,
    suppliers,
    inventoryLocations,
    checklistTemplates,
    trainingModules,
    documents,
    users,
    serviceAreas,
    transactions,
    budgets,
  ] = isAdmin
    ? await Promise.all([
        db.appSetting.findMany(),
        db.product.findMany({ orderBy: { name: "asc" } }),
        db.kitTemplate.findMany({
          include: {
            items: { include: { product: true } },
          },
          orderBy: { name: "asc" },
        }),
        db.inventoryRule.findMany({ include: { product: true } }),
        db.supplier.findMany({
          include: {
            prices: { include: { product: true } },
          },
          orderBy: { name: "asc" },
        }),
        db.inventoryLocation.findMany({
          include: { stock: true },
          orderBy: { name: "asc" },
        }),
        db.checklistTemplate.findMany({
          include: {
            items: { orderBy: { sortOrder: "asc" } },
          },
          orderBy: { name: "asc" },
        }),
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
        db.user.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, role: true },
        }),
        db.serviceArea.findMany({ orderBy: { prefix: "asc" } }),
        db.transaction.findMany({
          orderBy: { date: "desc" },
          include: { job: { select: { id: true, clientName: true } } },
        }),
        db.budget.findMany({ orderBy: [{ period: "desc" }, { category: "asc" }] }),
      ])
    : [[], [], [], [], [], [], [], [], [], [], [], [], []];

  // Notification catalog — auto-seed on first admin visit, then load.
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
    const existingCount = await db.notificationSetting.count();
    if (existingCount === 0) {
      try {
        await seedNotificationCatalog();
      } catch (e) {
        console.error("Failed to seed notification catalog", e);
      }
    }
    notificationSettings = await db.notificationSetting.findMany({
      orderBy: [{ recipient: "asc" }, { sortOrder: "asc" }],
    });
  }

  // Budget editor data (mirrors the finances page serialization).
  const txRows = transactions.map((t) => ({
    id: t.id,
    date: t.date.toISOString(),
    category: t.category,
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
    category: b.category,
    period: b.period,
    amount: b.amount,
    notes: b.notes,
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <SettingsClient
        user={userWithRole}
        isAdmin={isAdmin}
        appSettings={appSettings as never}
        products={products as never}
        kitTemplates={kitTemplates as never}
        inventoryRules={inventoryRules as never}
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
      />
    </div>
  );
}
