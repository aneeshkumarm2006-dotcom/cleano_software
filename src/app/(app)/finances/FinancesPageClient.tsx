"use client";

import { useState } from "react";
import {
  BookOpen,
  FileBarChart,
  Calculator,
  TrendingUp,
  Target,
} from "lucide-react";
import BookkeepingTab from "./tabs/BookkeepingTab";
import IncomeStatementTab from "./tabs/IncomeStatementTab";
import TaxCalculatorTab from "./tabs/TaxCalculatorTab";
import PLStatementTab from "./tabs/PLStatementTab";
import BudgetDashboardTab from "./tabs/BudgetDashboardTab";
import {
  BudgetRow,
  JobOption,
  TaxConfig,
  TransactionRow,
} from "./types";

interface Props {
  transactions: TransactionRow[];
  budgets: BudgetRow[];
  taxConfig: TaxConfig;
  jobOptions: JobOption[];
}

type TabId =
  | "bookkeeping"
  | "incomeStatement"
  | "taxCalculator"
  | "plStatement"
  | "budgetDashboard";

interface TabDef {
  id: TabId;
  label: string;
  icon: typeof BookOpen;
}

const TABS: TabDef[] = [
  { id: "bookkeeping", label: "Bookkeeping", icon: BookOpen },
  { id: "incomeStatement", label: "Income Statement", icon: FileBarChart },
  { id: "taxCalculator", label: "Tax Calculator", icon: Calculator },
  { id: "plStatement", label: "P&L Statement", icon: TrendingUp },
  { id: "budgetDashboard", label: "Budget Dashboard", icon: Target },
];

export default function FinancesPageClient({
  transactions,
  budgets,
  taxConfig,
  jobOptions,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("bookkeeping");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
          Finances
        </h1>
        <p className="text-sm text-[#005F6A]/70 !font-light mt-1">
          Track transactions, budgets, taxes and profitability
        </p>
      </div>

      <div className="flex gap-6">
        <nav className="w-60 flex-shrink-0">
          <div className="bg-[#005F6A]/5 rounded-2xl p-1 space-y-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-[350] transition-all duration-200 whitespace-nowrap ${
                    active
                      ? "bg-[#005F6A]/90 text-white"
                      : "text-[#005F6A] hover:bg-[#005F6A]/10"
                  }`}>
                  <Icon strokeWidth={1.6} className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex-1 min-w-0">
          {activeTab === "bookkeeping" && (
            <BookkeepingTab
              transactions={transactions}
              jobOptions={jobOptions}
            />
          )}
          {activeTab === "incomeStatement" && (
            <IncomeStatementTab transactions={transactions} />
          )}
          {activeTab === "taxCalculator" && (
            <TaxCalculatorTab
              transactions={transactions}
              taxConfig={taxConfig}
            />
          )}
          {activeTab === "plStatement" && (
            <PLStatementTab transactions={transactions} />
          )}
          {activeTab === "budgetDashboard" && (
            <BudgetDashboardTab
              transactions={transactions}
              budgets={budgets}
            />
          )}
        </div>
      </div>
    </div>
  );
}
