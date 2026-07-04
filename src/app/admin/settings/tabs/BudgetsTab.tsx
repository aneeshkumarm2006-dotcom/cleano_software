"use client";

import BudgetDashboardTab from "../../finances/tabs/BudgetDashboardTab";
import type { TransactionRow, BudgetRow } from "../../finances/types";

interface BudgetsTabProps {
  transactions: TransactionRow[];
  budgets: BudgetRow[];
}

/**
 * Settings wrapper around the finances budget dashboard — same editor
 * (add / edit / delete budgets + budget-vs-actual view), reachable from
 * Settings per the client's request.
 */
export default function BudgetsTab({ transactions, budgets }: BudgetsTabProps) {
  return <BudgetDashboardTab transactions={transactions} budgets={budgets} />;
}
