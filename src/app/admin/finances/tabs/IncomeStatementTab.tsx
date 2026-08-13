"use client";

import { useMemo, useState } from "react";
import { FileBarChart } from "lucide-react";
import Card from "@/components/ui/Card";
import PremiumSelect from "@/components/ui/PremiumSelect";
import {
  BudgetCategoryOption,
  TransactionRow,
  formatCurrency,
  formatMonth,
  indexCategories,
  isRevenueCategory,
} from "../types";

interface Props {
  transactions: TransactionRow[];
  categories: BudgetCategoryOption[];
}

type Period = "month" | "quarter" | "year" | "all";

function periodStart(period: Period): Date | null {
  const now = new Date();
  if (period === "all") return null;
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    return new Date(now.getFullYear(), q * 3, 1);
  }
  return new Date(now.getFullYear(), 0, 1);
}

export default function IncomeStatementTab({
  transactions,
  categories,
}: Props) {
  const [period, setPeriod] = useState<Period>("month");
  const catIndex = useMemo(() => indexCategories(categories), [categories]);

  const { revenueTotal, expenseLines, expenseTotal, netIncome, rows } =
    useMemo(() => {
      const start = periodStart(period);
      const filtered = transactions.filter((t) => {
        if (!start) return true;
        return new Date(t.date) >= start;
      });

      let revenueTotal = 0;
      const byCategory = new Map<string, number>();

      for (const t of filtered) {
        if (isRevenueCategory(catIndex, t.categoryId)) revenueTotal += t.amount;
        else {
          byCategory.set(
            t.categoryId,
            (byCategory.get(t.categoryId) ?? 0) + t.amount
          );
        }
      }

      // One line per live expense category, plus any archived one that still
      // has spend in this period — a statement that silently omits a retired
      // category stops adding up to its own total.
      const expenseLines = categories
        .filter(
          (c) =>
            c.kind === "EXPENSE" &&
            (!c.archived || (byCategory.get(c.id) ?? 0) !== 0)
        )
        .map((c) => ({
          id: c.id,
          name: c.name,
          amount: byCategory.get(c.id) ?? 0,
        }));

      let expenseTotal = 0;
      for (const amount of byCategory.values()) expenseTotal += amount;

      const monthlyMap = new Map<
        string,
        { month: string; revenue: number; expenses: number }
      >();
      for (const t of filtered) {
        const m = formatMonth(t.date);
        if (!monthlyMap.has(m))
          monthlyMap.set(m, { month: m, revenue: 0, expenses: 0 });
        const row = monthlyMap.get(m)!;
        if (isRevenueCategory(catIndex, t.categoryId)) row.revenue += t.amount;
        else row.expenses += t.amount;
      }
      const rows = Array.from(monthlyMap.values()).sort((a, b) =>
        a.month.localeCompare(b.month)
      );

      return {
        revenueTotal,
        expenseLines,
        expenseTotal,
        netIncome: revenueTotal - expenseTotal,
        rows,
      };
    }, [transactions, categories, catIndex, period]);

  const selectCls =
    "px-4 py-2 rounded-xl border border-transparent bg-[#008C9C]/5 text-sm text-[#008C9C] focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20";

  return (
    <Card variant="default" className="p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-2">
          <div className="p-2 bg-[#008C9C]/10 rounded-lg">
            <FileBarChart className="w-4 h-4 text-[#008C9C]" />
          </div>
          <div>
            <h2 className="text-sm font-[350] text-[#008C9C]/80">
              Income Statement
            </h2>
            <p className="text-xs text-[#008C9C]/60 mt-1">
              Automated profit & loss by period.
            </p>
          </div>
        </div>
        <PremiumSelect
          value={period}
          onChange={(v) => setPeriod(v as Period)}
          options={[
            { value: "month", label: "This Month" },
            { value: "quarter", label: "This Quarter" },
            { value: "year", label: "Year to Date" },
            { value: "all", label: "All Time" },
          ]}
          size="sm"
        />
      </div>

      <div className="rounded-2xl border border-[#008C9C]/10 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            <tr className="bg-[#008C9C]/5">
              <td className="px-5 py-3 text-xs uppercase tracking-wider text-[#008C9C]/70 font-[500]">
                Revenue
              </td>
              <td className="px-5 py-3"></td>
            </tr>
            <tr className="border-t border-[#008C9C]/5">
              <td className="px-5 py-3 text-[#008C9C]/80 pl-8">Total Revenue</td>
              <td className="px-5 py-3 text-right text-[#008C9C] font-[500]">
                {formatCurrency(revenueTotal)}
              </td>
            </tr>
            <tr className="bg-[#008C9C]/5 border-t border-[#008C9C]/10">
              <td className="px-5 py-3 text-xs uppercase tracking-wider text-[#008C9C]/70 font-[500]">
                Expenses
              </td>
              <td className="px-5 py-3"></td>
            </tr>
            {expenseLines.map((line) => (
              <tr key={line.id} className="border-t border-[#008C9C]/5">
                <td className="px-5 py-3 text-[#008C9C]/80 pl-8">{line.name}</td>
                <td className="px-5 py-3 text-right text-[#008C9C]/80">
                  {formatCurrency(line.amount)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-[#008C9C]/10 bg-[#008C9C]/5">
              <td className="px-5 py-3 text-[#008C9C] font-[500]">
                Total Expenses
              </td>
              <td className="px-5 py-3 text-right text-[#008C9C] font-[500]">
                {formatCurrency(expenseTotal)}
              </td>
            </tr>
            <tr className="border-t border-[#008C9C]/15">
              <td className="px-5 py-4 text-[#008C9C] font-[500] text-base">
                Net Income
              </td>
              <td
                className={`px-5 py-4 text-right text-base font-[500] ${
                  netIncome >= 0 ? "text-green-700" : "text-red-600"
                }`}>
                {formatCurrency(netIncome)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {rows.length > 1 && (
        <div className="mt-5">
          <h3 className="text-xs uppercase tracking-wider text-[#008C9C]/70 mb-2">
            Monthly Breakdown
          </h3>
          <div className="rounded-2xl border border-[#008C9C]/10 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#008C9C]/5 text-[#008C9C]/70 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-5 py-3 font-[500]">Month</th>
                  <th className="text-right px-5 py-3 font-[500]">Revenue</th>
                  <th className="text-right px-5 py-3 font-[500]">Expenses</th>
                  <th className="text-right px-5 py-3 font-[500]">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const net = r.revenue - r.expenses;
                  return (
                    <tr key={r.month} className="border-t border-[#008C9C]/5">
                      <td className="px-5 py-3 text-[#008C9C]/80">{r.month}</td>
                      <td className="px-5 py-3 text-right text-[#008C9C]/80">
                        {formatCurrency(r.revenue)}
                      </td>
                      <td className="px-5 py-3 text-right text-[#008C9C]/80">
                        {formatCurrency(r.expenses)}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-[500] ${
                          net >= 0 ? "text-green-700" : "text-red-600"
                        }`}>
                        {formatCurrency(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
