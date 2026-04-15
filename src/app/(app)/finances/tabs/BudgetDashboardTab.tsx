"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Target, Plus, Pencil, Trash2, X } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { CBarChart } from "@/components/ui/Chart";
import { createBudget, deleteBudget } from "../../actions/createBudget";
import { updateBudget } from "../../actions/updateBudget";
import {
  BudgetRow,
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  TransactionRow,
  TxCategory,
  formatCurrency,
  formatMonth,
} from "../types";

interface Props {
  transactions: TransactionRow[];
  budgets: BudgetRow[];
}

const ALL_CATEGORIES: TxCategory[] = [
  "REVENUE",
  ...EXPENSE_CATEGORIES,
];

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface FormState {
  id: string | null;
  category: TxCategory;
  period: string;
  amount: string;
  notes: string;
}

function emptyForm(): FormState {
  return {
    id: null,
    category: "SUPPLIES",
    period: currentPeriod(),
    amount: "",
    notes: "",
  };
}

export default function BudgetDashboardTab({ transactions, budgets }: Props) {
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriod());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periodOptions = useMemo(() => {
    const set = new Set<string>();
    set.add(currentPeriod());
    for (const b of budgets) set.add(b.period);
    for (const t of transactions) set.add(formatMonth(t.date));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [budgets, transactions]);

  const rows = useMemo(() => {
    const actuals: Record<TxCategory, number> = {
      REVENUE: 0,
      SUPPLIES: 0,
      LABOUR: 0,
      OVERHEAD: 0,
      OTHER: 0,
    };
    for (const t of transactions) {
      if (formatMonth(t.date) === period) actuals[t.category] += t.amount;
    }
    return ALL_CATEGORIES.map((c) => {
      const budget = budgets.find(
        (b) => b.category === c && b.period === period
      );
      const actual = actuals[c];
      const budgeted = budget?.amount ?? 0;
      const variance = budgeted - actual;
      const pct = budgeted > 0 ? (actual / budgeted) * 100 : 0;
      return {
        id: budget?.id ?? null,
        category: c,
        budgeted,
        actual,
        variance,
        pct,
        notes: budget?.notes ?? null,
      };
    });
  }, [transactions, budgets, period]);

  const chartData = rows
    .filter((r) => r.budgeted > 0 || r.actual > 0)
    .map((r) => ({
      name: CATEGORY_LABELS[r.category],
      Budget: r.budgeted,
      Actual: r.actual,
    }));

  function openCreate() {
    setForm({ ...emptyForm(), period });
    setShowForm(true);
    setError(null);
  }

  function openEdit(row: (typeof rows)[number]) {
    if (!row.id) return;
    setForm({
      id: row.id,
      category: row.category,
      period,
      amount: String(row.budgeted),
      notes: row.notes ?? "",
    });
    setShowForm(true);
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const amount = parseFloat(form.amount);
    const payload = {
      category: form.category,
      period: form.period,
      amount,
      notes: form.notes || null,
    };
    const res = form.id
      ? await updateBudget({ id: form.id, ...payload })
      : await createBudget(payload);
    setSaving(false);
    if (!res.success) {
      setError(res.error || "Failed to save budget");
      return;
    }
    setShowForm(false);
    setForm(emptyForm());
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this budget?")) return;
    const res = await deleteBudget(id);
    if (!res.success) {
      alert(res.error || "Failed to delete");
      return;
    }
    router.refresh();
  }

  function rowColor(pct: number, category: TxCategory) {
    if (category === "REVENUE") {
      if (pct >= 100) return "bg-green-50 text-green-700";
      if (pct >= 80) return "bg-yellow-50 text-yellow-700";
      return "bg-red-50 text-red-600";
    }
    if (pct <= 80) return "bg-green-50 text-green-700";
    if (pct <= 100) return "bg-yellow-50 text-yellow-700";
    return "bg-red-50 text-red-600";
  }

  const inputCls =
    "w-full px-4 py-2.5 rounded-xl border border-transparent bg-[#005F6A]/5 text-sm text-[#005F6A] placeholder:text-[#005F6A]/40 focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20";
  const selectCls = inputCls;

  return (
    <Card variant="default" className="p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-2">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <Target className="w-4 h-4 text-[#005F6A]" />
          </div>
          <div>
            <h2 className="text-sm font-[350] text-[#005F6A]/80">
              Budget Dashboard
            </h2>
            <p className="text-xs text-[#005F6A]/60 mt-1">
              Monthly budget vs actual by category.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-4 py-2 rounded-xl border border-transparent bg-[#005F6A]/5 text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20">
            {periodOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            border={false}
            onClick={openCreate}
            className="rounded-xl px-4 py-2">
            <Plus className="w-4 h-4 mr-2" />
            Set Budget
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="mb-5 rounded-2xl border border-[#005F6A]/10 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-[400] text-[#005F6A]">
              {form.id ? "Edit Budget" : "New Budget"}
            </h3>
            <button
              onClick={() => setShowForm(false)}
              className="text-[#005F6A]/60 hover:text-[#005F6A]">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                Category
              </label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as TxCategory })
                }
                className={selectCls}>
                {ALL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                Period (YYYY-MM)
              </label>
              <input
                type="text"
                value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value })}
                pattern="\d{4}-\d{2}"
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                Amount
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                Notes
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className={inputCls}
              />
            </div>
            {error && (
              <div className="col-span-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs p-3">
                {error}
              </div>
            )}
            <div className="col-span-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                border={false}
                onClick={() => setShowForm(false)}
                className="rounded-xl px-5 py-2">
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                border={false}
                disabled={saving}
                className="rounded-xl px-5 py-2">
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-[#005F6A]/10 bg-white mb-5">
        <table className="w-full text-sm">
          <thead className="bg-[#005F6A]/5 text-[#005F6A]/70 text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3 font-[500]">Category</th>
              <th className="text-right px-4 py-3 font-[500]">Budget</th>
              <th className="text-right px-4 py-3 font-[500]">Actual</th>
              <th className="text-right px-4 py-3 font-[500]">Variance</th>
              <th className="text-left px-4 py-3 font-[500]">Progress</th>
              <th className="text-right px-4 py-3 font-[500]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category} className="border-t border-[#005F6A]/5">
                <td className="px-4 py-3 text-[#005F6A]/80">
                  {CATEGORY_LABELS[r.category]}
                </td>
                <td className="px-4 py-3 text-right text-[#005F6A]/80">
                  {formatCurrency(r.budgeted)}
                </td>
                <td className="px-4 py-3 text-right text-[#005F6A]/80">
                  {formatCurrency(r.actual)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-[500] ${
                    r.variance >= 0 ? "text-green-700" : "text-red-600"
                  }`}>
                  {formatCurrency(r.variance)}
                </td>
                <td className="px-4 py-3 w-48">
                  {r.budgeted > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-[#005F6A]/10 overflow-hidden">
                        <div
                          className={`h-full ${
                            rowColor(r.pct, r.category).split(" ")[0]
                          }`}
                          style={{ width: `${Math.min(100, r.pct)}%` }}
                        />
                      </div>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full ${rowColor(
                          r.pct,
                          r.category
                        )}`}>
                        {r.pct.toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-[#005F6A]/40">
                      No budget set
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.id ? (
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => openEdit(r)}
                        className="p-1.5 rounded-lg hover:bg-[#005F6A]/10 text-[#005F6A]/70">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => r.id && handleDelete(r.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-600/80">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-[#005F6A]/40">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chartData.length > 0 && (
        <div className="rounded-2xl border border-[#005F6A]/10 bg-white p-4">
          <h3 className="text-xs uppercase tracking-wider text-[#005F6A]/70 mb-3">
            Budget vs Actual
          </h3>
          <CBarChart
            data={chartData}
            dataKeys={["Budget", "Actual"]}
            height={280}
          />
        </div>
      )}
    </Card>
  );
}
