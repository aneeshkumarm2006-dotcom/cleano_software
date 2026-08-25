import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import FinancesPageClient from "./FinancesPageClient";
import { formatDate } from "@/lib/timezone";
import { getBudgetCategoryOptions } from "@/lib/budget-categories";

export default async function FinancesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  const [transactions, budgets, categories, taxConfig, jobs] = await Promise.all([
    db.transaction.findMany({
      orderBy: { date: "desc" },
      include: {
        job: { select: { id: true, clientName: true } },
      },
    }),
    db.budget.findMany({
      orderBy: [{ period: "desc" }, { category: { sortOrder: "asc" } }],
    }),
    getBudgetCategoryOptions(),
    db.appSetting.findUnique({ where: { key: "tax.config" } }),
    db.job.findMany({
      // Job picker for linking a transaction — archived jobs aren't offered
      // (new fix list item 1).
      where: { deletedAt: null },
      select: { id: true, clientName: true, jobDate: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  const raw = (taxConfig?.value ?? null) as {
    gstRate?: number;
    qstRate?: number;
    gstNumber?: string;
    qstNumber?: string;
  } | null;
  const taxConfigValue = {
    gstRate: raw?.gstRate ?? 5,
    qstRate: raw?.qstRate ?? 9.975,
    gstNumber: raw?.gstNumber ?? "",
    qstNumber: raw?.qstNumber ?? "",
  };

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

  const jobOptions = jobs.map((j) => ({
    id: j.id,
    label: `${j.clientName}${j.jobDate ? ` — ${formatDate(j.jobDate)}` : ""}`,
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <FinancesPageClient
        transactions={txRows}
        budgets={budgetRows}
        categories={categories}
        taxConfig={taxConfigValue}
        jobOptions={jobOptions}
      />
    </div>
  );
}
