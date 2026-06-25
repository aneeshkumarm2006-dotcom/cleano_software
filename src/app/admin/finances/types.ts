import type { TransactionCategory } from "@prisma/client";

export type TxCategory = TransactionCategory;

export interface TransactionRow {
  id: string;
  date: string;
  category: TxCategory;
  amount: number;
  description: string | null;
  notes: string | null;
  jobId: string | null;
  jobClientName: string | null;
  source: string | null;
  taxAmount: number;
  isAuto: boolean;
}

export interface BudgetRow {
  id: string;
  category: TxCategory;
  period: string;
  amount: number;
  notes: string | null;
}

export interface TaxConfig {
  gstRate: number;
  qstRate: number;
  gstNumber: string;
  qstNumber: string;
}

export interface JobOption {
  id: string;
  label: string;
}

export const CATEGORY_LABELS: Record<TxCategory, string> = {
  REVENUE: "Revenue",
  SUPPLIES: "Supplies",
  LABOUR: "Labour",
  OVERHEAD: "Overhead",
  OTHER: "Other",
};

export const EXPENSE_CATEGORIES: TxCategory[] = [
  "SUPPLIES",
  "LABOUR",
  "OVERHEAD",
  "OTHER",
];

export function formatMonth(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatCurrency(n: number): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
