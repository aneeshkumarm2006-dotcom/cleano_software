"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import BudgetDashboardTab from "../../finances/tabs/BudgetDashboardTab";
import type {
  BudgetCategoryKind,
  BudgetCategoryOption,
  TransactionRow,
  BudgetRow,
} from "../../finances/types";
import { archivesInsteadOfDeleting } from "../../finances/types";
import {
  createBudgetCategory,
  deleteBudgetCategory,
  moveBudgetCategory,
  restoreBudgetCategory,
  updateBudgetCategory,
} from "../../actions/budgetCategories";
import { Feedback, Msg, SectionCard, themedInputClass, themedSelectClass } from "./_shared";

interface BudgetsTabProps {
  transactions: TransactionRow[];
  budgets: BudgetRow[];
  categories: BudgetCategoryOption[];
  /**
   * Owned by `SettingsClient` so the sidebar count moves with the table. Every
   * mutation below applies here first; the next server payload replaces the
   * whole list, so the optimistic copy can only ever be briefly ahead, never
   * divergent.
   */
  onCategoriesChange: (next: BudgetCategoryOption[]) => void;
}

const KIND_LABEL: Record<BudgetCategoryKind, string> = {
  REVENUE: "Income",
  EXPENSE: "Expense",
};

function usageLabel(c: BudgetCategoryOption): string {
  const parts: string[] = [];
  if (c.budgetCount > 0) {
    parts.push(`${c.budgetCount} budget${c.budgetCount === 1 ? "" : "s"}`);
  }
  if (c.transactionCount > 0) {
    parts.push(
      `${c.transactionCount} transaction${c.transactionCount === 1 ? "" : "s"}`
    );
  }
  return parts.length ? parts.join(" · ") : "Not used yet";
}

/**
 * Settings → Budgets (client item 12 · Stage 8.3).
 *
 * Two stacked cards: the category editor the client asked for
 * (*"we should just be able to write our own"*), then the existing budget
 * dashboard, which now draws its rows from whatever categories exist here.
 *
 * Delete is honest about which of two things it does — a category carrying
 * budgets or transactions is archived, not removed, because deleting it would
 * take a year of bookkeeping with it. The button says so before it is clicked.
 */
export default function BudgetsTab({
  transactions,
  budgets,
  categories,
  onCategoriesChange,
}: BudgetsTabProps) {
  const router = useRouter();

  const live = useMemo(() => categories.filter((c) => !c.archived), [categories]);
  const archived = useMemo(
    () => categories.filter((c) => c.archived),
    [categories]
  );

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<BudgetCategoryKind>("EXPENSE");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState<BudgetCategoryKind>("EXPENSE");
  const [pendingDelete, setPendingDelete] =
    useState<BudgetCategoryOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  /**
   * Run a category mutation, then apply its effect to the list held above.
   *
   * `apply` runs BEFORE `router.refresh()` on purpose: the refresh re-renders a
   * page that queries every settings section, so on a slow link it is the slow
   * path, and until it lands the table would otherwise sit unchanged under a
   * success message.
   */
  async function run<T extends { success: boolean; error?: string }>(
    call: () => Promise<T>,
    onSuccess: (res: T) => string,
    apply?: (res: T, prev: BudgetCategoryOption[]) => BudgetCategoryOption[]
  ) {
    setBusy(true);
    setMsg(null);
    const res = await call();
    setBusy(false);
    if (!res.success) {
      setMsg({ type: "error", text: res.error || "Something went wrong." });
      return false;
    }
    setMsg({ type: "success", text: onSuccess(res) });
    if (apply) onCategoriesChange(apply(res, categories));
    router.refresh();
    return true;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const kind = newKind;
    const ok = await run(
      () => createBudgetCategory({ name, kind }),
      () => `"${name}" added.`,
      (res, prev) => {
        const created = (res as { category?: BudgetCategoryOption }).category;
        return created ? [...prev, created] : prev;
      }
    );
    if (ok) {
      setNewName("");
      setNewKind("EXPENSE");
    }
  }

  function startEdit(c: BudgetCategoryOption) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditKind(c.kind);
    setMsg(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    const id = editingId;
    const kind = editKind;
    // Close the editor first. It used to close only after the await returned,
    // so a rename against a slow database left the row stuck in edit mode long
    // enough to read as "nothing happened".
    setEditingId(null);
    const ok = await run(
      () => updateBudgetCategory({ id, name, kind }),
      () => `Renamed to "${name}". Every budget and transaction follows.`,
      (_res, prev) =>
        prev.map((c) => (c.id === id ? { ...c, name, kind } : c))
    );
    if (!ok) {
      // Put the admin back in the editor with what they typed, so a rejected
      // name (duplicate, too long) can be corrected rather than retyped.
      setEditingId(id);
      setEditName(name);
      setEditKind(kind);
    }
  }

  async function handleDelete() {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    await run(
      () => deleteBudgetCategory(target.id),
      (res) =>
        (res as { archived?: boolean }).archived
          ? `"${target.name}" archived — hidden from the pickers, history kept.`
          : `"${target.name}" deleted.`,
      (res, prev) =>
        (res as { archived?: boolean }).archived
          ? prev.map((c) =>
              c.id === target.id ? { ...c, archived: true } : c
            )
          : prev.filter((c) => c.id !== target.id)
    );
  }

  /**
   * The list `moveBudgetCategory` produces: it re-indexes EVERY row
   * sequentially in the table's own order (`sortOrder`, then name), so the same
   * calculation is reproduced here rather than guessing at a two-row swap.
   */
  function reorderLocally(
    prev: BudgetCategoryOption[],
    id: string,
    direction: "up" | "down"
  ): BudgetCategoryOption[] {
    const ordered = [...prev].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    );
    const from = ordered.findIndex((c) => c.id === id);
    if (from === -1) return prev;
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= ordered.length) return prev;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    return ordered.map((c, i) => ({ ...c, sortOrder: i }));
  }

  const deleteArchives =
    !!pendingDelete && archivesInsteadOfDeleting(pendingDelete);

  return (
    <div className="space-y-6">
      <SectionCard
        title="Budget categories"
        description="Add your own categories, rename them, or retire ones you no longer use. Budgets, bookkeeping and Budget vs Actuals all read from this list."
        icon={Tags}>
        <div className="rounded-2xl border border-[#008C9C]/10 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#008C9C]/5 text-[#008C9C]/70 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-[500]">Category</th>
                <th className="text-left px-4 py-3 font-[500]">Type</th>
                <th className="text-left px-4 py-3 font-[500]">In use</th>
                <th className="text-right px-4 py-3 font-[500]">Order</th>
                <th className="text-right px-4 py-3 font-[500]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {live.map((c, i) => (
                <tr key={c.id} className="border-t border-[#008C9C]/5">
                  {editingId === c.id ? (
                    <td colSpan={5} className="px-4 py-3">
                      <form
                        onSubmit={handleSaveEdit}
                        className="flex flex-wrap items-center gap-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          maxLength={40}
                          autoFocus
                          className={`${themedInputClass} flex-1 min-w-[180px]`}
                        />
                        <select
                          value={editKind}
                          onChange={(e) =>
                            setEditKind(e.target.value as BudgetCategoryKind)
                          }
                          className={`${themedSelectClass} w-auto`}>
                          <option value="EXPENSE">Expense</option>
                          <option value="REVENUE">Income</option>
                        </select>
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          border={false}
                          disabled={busy}
                          className="rounded-xl px-4 py-2">
                          Save
                        </Button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-2 rounded-lg hover:bg-[#008C9C]/10 text-[#008C9C]/70"
                          aria-label="Cancel">
                          <X className="w-4 h-4" />
                        </button>
                        {editKind !== c.kind && (
                          <span className="w-full text-[11px] text-amber-700">
                            Changing the type re-files every transaction already
                            in “{c.name}” — {usageLabel(c)}.
                          </span>
                        )}
                      </form>
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-[#008C9C]/80">
                        {c.name}
                        {c.isDefault && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-[#008C9C]/40">
                            Default
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full ${
                            c.kind === "REVENUE"
                              ? "bg-green-50 text-green-700"
                              : "bg-[#008C9C]/8 text-[#008C9C]/70"
                          }`}>
                          {KIND_LABEL[c.kind]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#008C9C]/60">
                        {usageLabel(c)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              run(
                                () => moveBudgetCategory(c.id, "up"),
                                () => "Order updated.",
                                (_res, prev) => reorderLocally(prev, c.id, "up")
                              )
                            }
                            disabled={busy || i === 0}
                            className="p-1.5 rounded-lg hover:bg-[#008C9C]/10 text-[#008C9C]/70 disabled:opacity-30"
                            aria-label={`Move ${c.name} up`}>
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              run(
                                () => moveBudgetCategory(c.id, "down"),
                                () => "Order updated.",
                                (_res, prev) => reorderLocally(prev, c.id, "down")
                              )
                            }
                            disabled={busy || i === live.length - 1}
                            className="p-1.5 rounded-lg hover:bg-[#008C9C]/10 text-[#008C9C]/70 disabled:opacity-30"
                            aria-label={`Move ${c.name} down`}>
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(c)}
                            disabled={busy}
                            className="p-1.5 rounded-lg hover:bg-[#008C9C]/10 text-[#008C9C]/70"
                            aria-label={`Rename ${c.name}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(c)}
                            disabled={busy}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-600/80"
                            aria-label={`Delete ${c.name}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {live.length === 0 && (
                <tr className="border-t border-[#008C9C]/5">
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-xs text-[#008C9C]/50">
                    No categories yet — add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="new-budget-category"
              className="text-xs text-[#008C9C]/70 uppercase tracking-wide mb-1 block">
              New category
            </label>
            <input
              id="new-budget-category"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Marketing"
              maxLength={40}
              className={themedInputClass}
            />
          </div>
          <div>
            <label
              htmlFor="new-budget-category-kind"
              className="text-xs text-[#008C9C]/70 uppercase tracking-wide mb-1 block">
              Type
            </label>
            <select
              id="new-budget-category-kind"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as BudgetCategoryKind)}
              className={`${themedSelectClass} w-auto`}>
              <option value="EXPENSE">Expense</option>
              <option value="REVENUE">Income</option>
            </select>
          </div>
          <Button
            type="submit"
            variant="action"
            border={false}
            disabled={busy || !newName.trim()}
            className="rounded-xl px-5 py-2.5">
            <Plus className="w-4 h-4 mr-2" />
            Add
          </Button>
        </form>
        <p className="text-xs text-[#008C9C]/50">
          Income categories add to revenue on the P&amp;L, income statement and
          tax figures; expense categories subtract.
        </p>

        {pendingDelete && (
          <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4 space-y-3">
            <p className="text-sm text-[#008C9C]">
              {deleteArchives ? (
                <>
                  <strong>{pendingDelete.name}</strong> will be{" "}
                  <strong>archived</strong>, not deleted
                  {pendingDelete.isDefault
                    ? " — it is one of the built-in categories the app posts to automatically"
                    : ` — it still has ${usageLabel(pendingDelete).toLowerCase()}`}
                  . It disappears from the pickers and keeps naming its history.
                </>
              ) : (
                <>
                  <strong>{pendingDelete.name}</strong> has no budgets or
                  transactions and will be deleted.
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                border={false}
                onClick={() => setPendingDelete(null)}
                className="rounded-xl px-5 py-2">
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                border={false}
                onClick={handleDelete}
                className="rounded-xl px-5 py-2">
                {deleteArchives ? "Archive" : "Delete"}
              </Button>
            </div>
          </div>
        )}

        {archived.length > 0 && (
          <div className="rounded-2xl border border-[#008C9C]/10 bg-[#008C9C]/[0.03] p-4 space-y-2">
            <h4 className="text-xs uppercase tracking-wider text-[#008C9C]/60">
              Archived — history only
            </h4>
            {archived.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 text-sm">
                <span className="text-[#008C9C]/70">
                  {c.name}
                  <span className="ml-2 text-xs text-[#008C9C]/45">
                    {usageLabel(c)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    run(
                      () => restoreBudgetCategory(c.id),
                      () => `"${c.name}" restored.`,
                      (_res, prev) =>
                        prev.map((x) =>
                          x.id === c.id ? { ...x, archived: false } : x
                        )
                    )
                  }
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs text-[#008C9C] hover:underline">
                  <ArchiveRestore className="w-3.5 h-3.5" />
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}

        {msg && <Feedback msg={msg} />}
      </SectionCard>

      <BudgetDashboardTab
        transactions={transactions}
        budgets={budgets}
        categories={categories}
      />
    </div>
  );
}
