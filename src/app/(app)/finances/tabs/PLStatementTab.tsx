"use client";

import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import Card from "@/components/ui/Card";
import { CAreaChart } from "@/components/ui/Chart";
import {
  TransactionRow,
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
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    return new Date(now.getFullYear(), q * 3, 1);
  }
  return new Date(now.getFullYear(), 0, 1);
}

export default function PLStatementTab({ transactions }: Props) {
  const [period, setPeriod] = useState<Period>("year");

  const { revenue, expenses, netProfit, grossMargin, netMargin, chartData } =
    useMemo(() => {
      const start = periodStart(period);
      const rows = transactions.filter((t) => {
        if (!start) return true;
        return new Date(t.date) >= start;
      });

      let revenue = 0;
      let expenses = 0;
      const monthMap = new Map<
        string,
        { name: string; revenue: number; expenses: number; net: number }
      >();

      for (const t of rows) {
        const m = formatMonth(t.date);
        if (!monthMap.has(m))
          monthMap.set(m, { name: m, revenue: 0, expenses: 0, net: 0 });
        const row = monthMap.get(m)!;
        if (t.category === "REVENUE") {
          revenue += t.amount;
          row.revenue += t.amount;
        } else {
          expenses += t.amount;
          row.expenses += t.amount;
        }
      }

      for (const row of monthMap.values()) row.net = row.revenue - row.expenses;
      const chartData = Array.from(monthMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      const netProfit = revenue - expenses;
      const grossMargin = revenue > 0 ? ((revenue - expenses) / revenue) * 100 : 0;
      const netMargin = grossMargin;
      return { revenue, expenses, netProfit, grossMargin, netMargin, chartData };
    }, [transactions, period]);

  const selectCls =
    "px-4 py-2 rounded-xl border border-transparent bg-[#005F6A]/5 text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20";

  return (
    <Card variant="default" className="p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-2">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <TrendingUp className="w-4 h-4 text-[#005F6A]" />
          </div>
          <div>
            <h2 className="text-sm font-[350] text-[#005F6A]/80">
              P&L Statement
            </h2>
            <p className="text-xs text-[#005F6A]/60 mt-1">
              Simplified profit & loss with margins.
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="rounded-xl bg-[#005F6A]/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[#005F6A]/60">
            Revenue
          </div>
          <div className="text-xl font-[400] text-[#005F6A] mt-1">
            {formatCurrency(revenue)}
          </div>
        </div>
        <div className="rounded-xl bg-[#005F6A]/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[#005F6A]/60">
            Expenses
          </div>
          <div className="text-xl font-[400] text-[#005F6A] mt-1">
            {formatCurrency(expenses)}
          </div>
        </div>
        <div className="rounded-xl bg-[#005F6A]/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[#005F6A]/60">
            Net Profit
          </div>
          <div
            className={`text-xl font-[400] mt-1 ${
              netProfit >= 0 ? "text-green-700" : "text-red-600"
            }`}>
            {formatCurrency(netProfit)}
          </div>
        </div>
        <div className="rounded-xl bg-[#005F6A]/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[#005F6A]/60">
            Net Margin
          </div>
          <div
            className={`text-xl font-[400] mt-1 ${
              netMargin >= 0 ? "text-green-700" : "text-red-600"
            }`}>
            {netMargin.toFixed(1)}%
          </div>
        </div>
      </div>

      {chartData.length > 0 ? (
        <div className="rounded-2xl border border-[#005F6A]/10 bg-white p-4">
          <h3 className="text-xs uppercase tracking-wider text-[#005F6A]/70 mb-3">
            Revenue vs Expenses Over Time
          </h3>
          <CAreaChart
            data={chartData}
            dataKeys={["revenue", "expenses", "net"]}
            height={280}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-[#005F6A]/10 bg-white p-8 text-center text-sm text-[#005F6A]/60">
          No transactions in this period.
        </div>
      )}

      <p className="text-[11px] text-[#005F6A]/50 mt-3">
        Gross margin: {grossMargin.toFixed(1)}% · Net margin: {netMargin.toFixed(1)}%
      </p>
    </Card>
  );
}
