"use client";

import { useMemo, useState } from "react";
import { FileBarChart } from "lucide-react";
import Card from "@/components/ui/Card";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  TransactionRow,
  TxCategory,
  formatCurrency,
  formatMonth,
} from "../types";

interface Props {
  transactions: TransactionRow[];
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

export default function IncomeStatementTab({ transactions }: Props) {
  const [period, setPeriod] = useState<Period>("month");

  const { revenueTotal, expenseByCategory, expenseTotal, netIncome, rows } =
    useMemo(() => {
      const start = periodStart(period);
      const filtered = transactions.filter((t) => {
        if (!start) return true;
        return new Date(t.date) >= start;
      });

      let revenueTotal = 0;
      const expenseByCategory: Record<TxCategory, number> = {
        REVENUE: 0,
        SUPPLIES: 0,
        LABOUR: 0,
        OVERHEAD: 0,
        OTHER: 0,
      };

      for (const t of filtered) {
        if (t.category === "REVENUE") revenueTotal += t.amount;
        else expenseByCategory[t.category] += t.amount;
      }

      let expenseTotal = 0;
      for (const c of EXPENSE_CATEGORIES) expenseTotal += expenseByCategory[c];

      const monthlyMap = new Map<
        string,
        { month: string; revenue: number; expenses: number }
      >();
      for (const t of filtered) {
        const m = formatMonth(t.date);
        if (!monthlyMap.has(m))
          monthlyMap.set(m, { month: m, revenue: 0, expenses: 0 });
        const row = monthlyMap.get(m)!;
        if (t.category === "REVENUE") row.revenue += t.amount;
        else row.expenses += t.amount;
      }
      const rows = Array.from(monthlyMap.values()).sort((a, b) =>
        a.month.localeCompare(b.month)
      );

      return {
        revenueTotal,
        expenseByCategory,
        expenseTotal,
        netIncome: revenueTotal - expenseTotal,
        rows,
      };
    }, [transactions, period]);

  const selectCls =
    "px-4 py-2 rounded-xl border border-transparent bg-[#005F6A]/5 text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20";

  return (
    <Card variant="default" className="p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-2">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <FileBarChart className="w-4 h-4 text-[#005F6A]" />
          </div>
          <div>
            <h2 className="text-sm font-[350] text-[#005F6A]/80">
              Income Statement
            </h2>
            <p className="text-xs text-[#005F6A]/60 mt-1">
              Automated profit & loss by period.
            </p>
          </div>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          className={selectCls}>
          <option value="month">This Month</option>
          <option value="quarter">This Quarter</option>
          <option value="year">Year to Date</option>
          <option value="all">All Time</option>
        </select>
      </div>

      <div className="rounded-2xl border border-[#005F6A]/10 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            <tr className="bg-[#005F6A]/5">
              <td className="px-5 py-3 text-xs uppercase tracking-wider text-[#005F6A]/70 font-[500]">
                Revenue
              </td>
              <td className="px-5 py-3"></td>
            </tr>
            <tr className="border-t border-[#005F6A]/5">
              <td className="px-5 py-3 text-[#005F6A]/80 pl-8">Total Revenue</td>
              <td className="px-5 py-3 text-right text-[#005F6A] font-[500]">
                {formatCurrency(revenueTotal)}
              </td>
            </tr>
            <tr className="bg-[#005F6A]/5 border-t border-[#005F6A]/10">
              <td className="px-5 py-3 text-xs uppercase tracking-wider text-[#005F6A]/70 font-[500]">
                Expenses
              </td>
              <td className="px-5 py-3"></td>
            </tr>
            {EXPENSE_CATEGORIES.map((c) => (
              <tr key={c} className="border-t border-[#005F6A]/5">
                <td className="px-5 py-3 text-[#005F6A]/80 pl-8">
                  {CATEGORY_LABELS[c]}
                </td>
                <td className="px-5 py-3 text-right text-[#005F6A]/80">
                  {formatCurrency(expenseByCategory[c])}
                </td>
              </tr>
            ))}
            <tr className="border-t border-[#005F6A]/10 bg-[#005F6A]/5">
              <td className="px-5 py-3 text-[#005F6A] font-[500]">
                Total Expenses
              </td>
              <td className="px-5 py-3 text-right text-[#005F6A] font-[500]">
                {formatCurrency(expenseTotal)}
              </td>
            </tr>
            <tr className="border-t border-[#005F6A]/15">
              <td className="px-5 py-4 text-[#005F6A] font-[500] text-base">
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
          <h3 className="text-xs uppercase tracking-wider text-[#005F6A]/70 mb-2">
            Monthly Breakdown
          </h3>
          <div className="rounded-2xl border border-[#005F6A]/10 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#005F6A]/5 text-[#005F6A]/70 text-[10px] uppercase tracking-wider">
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
                    <tr key={r.month} className="border-t border-[#005F6A]/5">
                      <td className="px-5 py-3 text-[#005F6A]/80">{r.month}</td>
                      <td className="px-5 py-3 text-right text-[#005F6A]/80">
                        {formatCurrency(r.revenue)}
                      </td>
                      <td className="px-5 py-3 text-right text-[#005F6A]/80">
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
