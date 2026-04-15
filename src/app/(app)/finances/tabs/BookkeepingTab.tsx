"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  Zap,
} from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { createTransaction } from "../../actions/createTransaction";
import { updateTransaction } from "../../actions/updateTransaction";
import { deleteTransaction } from "../../actions/deleteTransaction";
import {
  BudgetRow as _BudgetRow,
  CATEGORY_LABELS,
  TransactionRow,
  TxCategory,
  formatCurrency,
  JobOption,
} from "../types";

interface Props {
  transactions: TransactionRow[];
  jobOptions: JobOption[];
}

const ALL_CATEGORIES: TxCategory[] = [
  "REVENUE",
  "SUPPLIES",
  "LABOUR",
  "OVERHEAD",
  "OTHER",
];

const PAGE_SIZE = 20;

interface FormState {
  id: string | null;
  date: string;
  category: TxCategory;
  amount: string;
  description: string;
  notes: string;
  jobId: string;
  source: string;
  taxAmount: string;
}

function emptyForm(): FormState {
  return {
    id: null,
    date: new Date().toISOString().slice(0, 10),
    category: "REVENUE",
    amount: "",
    description: "",
    notes: "",
    jobId: "",
    source: "",
    taxAmount: "0",
  };
}

export default function BookkeepingTab({ transactions, jobOptions }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<TxCategory | "ALL">(
    "ALL"
  );
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (categoryFilter !== "ALL" && t.category !== categoryFilter)
        return false;
      if (fromDate && t.date < new Date(fromDate).toISOString()) return false;
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        if (t.date > end.toISOString()) return false;
      }
      if (q) {
        const text = [
          t.description,
          t.notes,
          t.jobClientName,
          t.source,
          CATEGORY_LABELS[t.category],
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, search, categoryFilter, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const totals = useMemo(() => {
    let revenue = 0;
    let expenses = 0;
    for (const t of filtered) {
      if (t.category === "REVENUE") revenue += t.amount;
      else expenses += t.amount;
    }
    return { revenue, expenses, net: revenue - expenses };
  }, [filtered]);

  function openCreate() {
    setForm(emptyForm());
    setShowForm(true);
    setError(null);
  }

  function openEdit(t: TransactionRow) {
    setForm({
      id: t.id,
      date: t.date.slice(0, 10),
      category: t.category,
      amount: String(t.amount),
      description: t.description ?? "",
      notes: t.notes ?? "",
      jobId: t.jobId ?? "",
      source: t.source ?? "",
      taxAmount: String(t.taxAmount ?? 0),
    });
    setShowForm(true);
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const amount = parseFloat(form.amount);
    const taxAmount = parseFloat(form.taxAmount) || 0;
    const payload = {
      date: form.date,
      category: form.category,
      amount,
      description: form.description || null,
      notes: form.notes || null,
      jobId: form.jobId || null,
      source: form.source || null,
      taxAmount,
    };
    const res = form.id
      ? await updateTransaction({ id: form.id, ...payload })
      : await createTransaction(payload);
    setSaving(false);
    if (!res.success) {
      setError(res.error || "Failed to save transaction");
      return;
    }
    setShowForm(false);
    setForm(emptyForm());
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this transaction?")) return;
    const res = await deleteTransaction(id);
    if (!res.success) {
      alert(res.error || "Failed to delete");
      return;
    }
    router.refresh();
  }

  const inputCls =
    "w-full px-4 py-2.5 rounded-xl border border-transparent bg-[#005F6A]/5 text-sm text-[#005F6A] placeholder:text-[#005F6A]/40 focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20";
  const selectCls = inputCls;

  return (
    <Card variant="default" className="p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-2">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <BookOpen className="w-4 h-4 text-[#005F6A]" />
          </div>
          <div>
            <h2 className="text-sm font-[350] text-[#005F6A]/80">
              Bookkeeping
            </h2>
            <p className="text-xs text-[#005F6A]/60 mt-1">
              Transaction ledger with manual and auto-recorded entries.
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          border={false}
          onClick={openCreate}
          className="rounded-xl px-4 py-2">
          <Plus className="w-4 h-4 mr-2" />
          Add Transaction
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl bg-[#005F6A]/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[#005F6A]/60">
            Revenue
          </div>
          <div className="text-xl font-[400] text-[#005F6A] mt-1">
            {formatCurrency(totals.revenue)}
          </div>
        </div>
        <div className="rounded-xl bg-[#005F6A]/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[#005F6A]/60">
            Expenses
          </div>
          <div className="text-xl font-[400] text-[#005F6A] mt-1">
            {formatCurrency(totals.expenses)}
          </div>
        </div>
        <div className="rounded-xl bg-[#005F6A]/5 p-4">
          <div className="text-xs uppercase tracking-wide text-[#005F6A]/60">
            Net
          </div>
          <div
            className={`text-xl font-[400] mt-1 ${
              totals.net >= 0 ? "text-[#005F6A]" : "text-red-600"
            }`}>
            {formatCurrency(totals.net)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="relative">
          <Search className="w-4 h-4 text-[#005F6A]/40 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className={`${inputCls} pl-9`}
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value as TxCategory | "ALL");
            setPage(1);
          }}
          className={selectCls}>
          <option value="ALL">All Categories</option>
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => {
            setFromDate(e.target.value);
            setPage(1);
          }}
          className={inputCls}
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => {
            setToDate(e.target.value);
            setPage(1);
          }}
          className={inputCls}
        />
      </div>

      {showForm && (
        <div className="mb-5 rounded-2xl border border-[#005F6A]/10 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-[400] text-[#005F6A]">
              {form.id ? "Edit Transaction" : "New Transaction"}
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
                Date
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
                className={inputCls}
              />
            </div>
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
                Amount
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                Tax Amount
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.taxAmount}
                onChange={(e) =>
                  setForm({ ...form, taxAmount: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                Description
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                Linked Job
              </label>
              <select
                value={form.jobId}
                onChange={(e) => setForm({ ...form, jobId: e.target.value })}
                className={selectCls}>
                <option value="">— none —</option>
                {jobOptions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                Source
              </label>
              <input
                type="text"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                placeholder="e.g. CASH, CARD, Vendor"
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
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

      <div className="overflow-x-auto rounded-2xl border border-[#005F6A]/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#005F6A]/5 text-[#005F6A]/70 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="text-left px-4 py-3 font-[500]">Date</th>
              <th className="text-left px-4 py-3 font-[500]">Category</th>
              <th className="text-left px-4 py-3 font-[500]">Description</th>
              <th className="text-left px-4 py-3 font-[500]">Job</th>
              <th className="text-right px-4 py-3 font-[500]">Tax</th>
              <th className="text-right px-4 py-3 font-[500]">Amount</th>
              <th className="text-right px-4 py-3 font-[500]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="text-center py-8 text-[#005F6A]/50 text-sm">
                  No transactions match these filters.
                </td>
              </tr>
            ) : (
              paged.map((t) => (
                <tr
                  key={t.id}
                  className="border-t border-[#005F6A]/5 hover:bg-[#005F6A]/3">
                  <td className="px-4 py-3 text-[#005F6A]/80 whitespace-nowrap">
                    {new Date(t.date).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-[500] ${
                        t.category === "REVENUE"
                          ? "bg-green-50 text-green-700"
                          : "bg-[#005F6A]/10 text-[#005F6A]"
                      }`}>
                      {CATEGORY_LABELS[t.category]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#005F6A]/80">
                    <div className="flex items-center gap-2">
                      {t.isAuto && (
                        <Zap
                          className="w-3 h-3 text-[#005F6A]/50"
                          strokeWidth={2}
                        />
                      )}
                      {t.description || "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#005F6A]/70">
                    {t.jobClientName || "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[#005F6A]/70">
                    {t.taxAmount ? formatCurrency(t.taxAmount) : "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-[500] ${
                      t.category === "REVENUE"
                        ? "text-green-700"
                        : "text-[#005F6A]"
                    }`}>
                    {t.category === "REVENUE" ? "+" : "−"}
                    {formatCurrency(t.amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => openEdit(t)}
                        className="p-1.5 rounded-lg hover:bg-[#005F6A]/10 text-[#005F6A]/70"
                        title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-600/80"
                        title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-xs text-[#005F6A]/70">
          <div>
            Page {currentPage} of {totalPages} · {filtered.length} entries
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg hover:bg-[#005F6A]/10 disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg hover:bg-[#005F6A]/10 disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
