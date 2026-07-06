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
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Finance</p>
        <h1 className="display">Finances</h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)" }}>
          Track transactions, budgets, taxes and profitability.
        </p>
      </header>

      {/* Sidebar + content: stacks on phones via .stack-mobile */}
      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
        <nav>
          <div style={{ background: "var(--primary-5)", borderRadius: 16, padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    background: active ? "var(--primary)" : "transparent",
                    color: active ? "#fff" : "var(--primary-70)",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}>
                  <Icon strokeWidth={1.6} size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div style={{ flex: 1, minWidth: 0 }}>
          {activeTab === "bookkeeping" && (
            <BookkeepingTab transactions={transactions} jobOptions={jobOptions} />
          )}
          {activeTab === "incomeStatement" && (
            <IncomeStatementTab transactions={transactions} />
          )}
          {activeTab === "taxCalculator" && (
            <TaxCalculatorTab transactions={transactions} taxConfig={taxConfig} />
          )}
          {activeTab === "plStatement" && (
            <PLStatementTab transactions={transactions} />
          )}
          {activeTab === "budgetDashboard" && (
            <BudgetDashboardTab transactions={transactions} budgets={budgets} />
          )}
        </div>
      </div>
    </div>
  );
}
