"use client";

import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import Card from "@/components/ui/Card";
import PremiumSelect from "@/components/ui/PremiumSelect";
import {
  TaxConfig,
  TransactionRow,
  formatCurrency,
} from "../types";

interface Props {
  transactions: TransactionRow[];
  taxConfig: TaxConfig;
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

export default function TaxCalculatorTab({ transactions, taxConfig }: Props) {
  const [period, setPeriod] = useState<Period>("quarter");

  const {
    revenueTotal,
    expenseTotal,
    taxCollected,
    taxPaidOnExpenses,
    netRemittance,
  } = useMemo(() => {
    const start = periodStart(period);
    const rows = transactions.filter((t) => {
      if (!start) return true;
      return new Date(t.date) >= start;
    });

    let revenueTotal = 0;
    let expenseTotal = 0;
    let taxCollected = 0;
    let taxPaidOnExpenses = 0;

    for (const t of rows) {
      if (t.category === "REVENUE") {
        revenueTotal += t.amount;
        taxCollected += t.taxAmount || 0;
      } else {
        expenseTotal += t.amount;
        taxPaidOnExpenses += t.taxAmount || 0;
      }
    }

    return {
      revenueTotal,
      expenseTotal,
      taxCollected,
      taxPaidOnExpenses,
      netRemittance: taxCollected - taxPaidOnExpenses,
    };
  }, [transactions, period]);

  const combinedRate = (taxConfig.gstRate || 0) + (taxConfig.qstRate || 0);
  const estimatedCollected = (revenueTotal * combinedRate) / 100;

  const selectCls =
    "px-4 py-2 rounded-xl border border-transparent bg-[#008C9C]/5 text-sm text-[#008C9C] focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20";

  return (
    <Card variant="default" className="p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-2">
          <div className="p-2 bg-[#008C9C]/10 rounded-lg">
            <Calculator className="w-4 h-4 text-[#008C9C]" />
          </div>
          <div>
            <h2 className="text-sm font-[350] text-[#008C9C]/80">
              Tax Calculator
            </h2>
            <p className="text-xs text-[#008C9C]/60 mt-1">
              GST/QST collected vs paid for the selected period.
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="rounded-xl bg-[#008C9C]/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[#008C9C]/60">
            GST Rate
          </div>
          <div className="text-xl font-[400] text-[#008C9C] mt-1">
            {taxConfig.gstRate.toFixed(3)}%
          </div>
          {taxConfig.gstNumber && (
            <div className="text-[11px] text-[#008C9C]/60 mt-1">
              {taxConfig.gstNumber}
            </div>
          )}
        </div>
        <div className="rounded-xl bg-[#008C9C]/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[#008C9C]/60">
            QST Rate
          </div>
          <div className="text-xl font-[400] text-[#008C9C] mt-1">
            {taxConfig.qstRate.toFixed(3)}%
          </div>
          {taxConfig.qstNumber && (
            <div className="text-[11px] text-[#008C9C]/60 mt-1">
              {taxConfig.qstNumber}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-[#008C9C]/10 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="px-5 py-3 text-[#008C9C]/80">Revenue</td>
              <td className="px-5 py-3 text-right text-[#008C9C]">
                {formatCurrency(revenueTotal)}
              </td>
            </tr>
            <tr className="border-t border-[#008C9C]/5">
              <td className="px-5 py-3 text-[#008C9C]/80">Expenses</td>
              <td className="px-5 py-3 text-right text-[#008C9C]">
                {formatCurrency(expenseTotal)}
              </td>
            </tr>
            <tr className="border-t border-[#008C9C]/5">
              <td className="px-5 py-3 text-[#008C9C]/80">
                Tax Collected (recorded)
              </td>
              <td className="px-5 py-3 text-right text-green-700 font-[500]">
                {formatCurrency(taxCollected)}
              </td>
            </tr>
            <tr className="border-t border-[#008C9C]/5">
              <td className="px-5 py-3 text-[#008C9C]/80">
                Tax Paid on Expenses (ITC)
              </td>
              <td className="px-5 py-3 text-right text-[#008C9C]">
                {formatCurrency(taxPaidOnExpenses)}
              </td>
            </tr>
            <tr className="border-t border-[#008C9C]/10 bg-[#008C9C]/5">
              <td className="px-5 py-4 text-[#008C9C] font-[500]">
                Net Remittance Owed
              </td>
              <td
                className={`px-5 py-4 text-right text-base font-[500] ${
                  netRemittance >= 0 ? "text-[#008C9C]" : "text-green-700"
                }`}>
                {formatCurrency(netRemittance)}
              </td>
            </tr>
            <tr className="border-t border-[#008C9C]/5">
              <td className="px-5 py-3 text-[#008C9C]/60 text-xs">
                Estimated if full GST+QST on revenue ({combinedRate.toFixed(3)}%)
              </td>
              <td className="px-5 py-3 text-right text-[#008C9C]/60 text-xs">
                {formatCurrency(estimatedCollected)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[#008C9C]/50 mt-3">
        Tax rates are managed in{" "}
        <a href="/settings" className="underline">
          Settings → Tax
        </a>
        . Recorded tax amounts come from revenue transactions automatically
        created when a job is marked as paid.
      </p>
    </Card>
  );
}
