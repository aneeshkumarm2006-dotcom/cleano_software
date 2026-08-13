"use client";

/**
 * Commissions tab (client feedback item 20, Stage 11.2).
 *
 * Two readings, in the order the question gets asked: **who are we paying and
 * how much** (per-rep totals, most owed first), then the entries behind those
 * numbers. Everything else — filters, the add/edit form, mark-paid — hangs off
 * those two.
 *
 * ⚠ Scope is a guess. The client gave one sentence and no rules for how a
 * commission is calculated, when it becomes payable, or whether reps are staff
 * accounts. This records and totals; it does not decide policy.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeDollarSign, Check, Plus, Trash2, Undo2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import PremiumSelect from "@/components/ui/PremiumSelect";
import {
  saveCommission,
  setCommissionPaid,
  markCommissionsPaid,
  deleteCommission,
} from "@/app/admin/actions/commissionActions";
import {
  commissionMoney,
  periodLabel,
  totalsByRep,
  type CommissionLeadOption,
  type CommissionRow,
  type SalesRepOption,
} from "./commissionTypes";
import { formatDate } from "@/lib/timezone";

type StatusFilter = "all" | "pending" | "paid";
type RelatedTo = "none" | "job" | "lead";

interface Props {
  commissions: CommissionRow[];
  /**
   * Owned by `SalesPageClient` so the header count, the per-rep totals and the
   * entries list move together. Every mutation below applies here BEFORE
   * `router.refresh()`: the refresh re-queries the whole sales page, so until it
   * lands the tab would otherwise still read "0 entries · $0.00 pending" under a
   * modal that has already closed. The next server payload replaces the list
   * wholesale, so the local copy can only ever be briefly ahead, never divergent.
   *
   * Nothing is applied until the action has reported success, so a failed
   * add / mark-paid / delete leaves the tab exactly as it was — the rollback is
   * that the overlay is never written.
   */
  onCommissionsChange: (next: CommissionRow[]) => void;
  reps: SalesRepOption[];
  leadOptions: CommissionLeadOption[];
  currentPeriod: string;
}

/**
 * The loader's ordering — newest period first, then newest entry — reproduced
 * here so an optimistically-added row lands where the refresh will put it,
 * rather than jumping when the server payload arrives.
 */
function sortLedger(rows: CommissionRow[]): CommissionRow[] {
  return [...rows].sort(
    (a, b) => b.period.localeCompare(a.period) || b.createdAt.localeCompare(a.createdAt)
  );
}

const EMPTY_FORM = {
  id: "",
  salesRepId: "",
  amount: "",
  rate: "",
  period: "",
  note: "",
  jobNumber: "",
  leadId: "",
};

export default function CommissionManager({
  commissions,
  onCommissionsChange,
  reps,
  leadOptions,
  currentPeriod,
}: Props) {
  const router = useRouter();

  const [status, setStatus] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<string>("all");
  const [repFilter, setRepFilter] = useState<string>("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [relatedTo, setRelatedTo] = useState<RelatedTo>("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const periods = useMemo(
    () => [...new Set(commissions.map((c) => c.period))].sort().reverse(),
    [commissions]
  );

  const filtered = useMemo(() => {
    return commissions.filter((c) => {
      if (status === "pending" && c.paidAt) return false;
      if (status === "paid" && !c.paidAt) return false;
      if (period !== "all" && c.period !== period) return false;
      if (repFilter !== "all" && c.salesRepId !== repFilter) return false;
      return true;
    });
  }, [commissions, status, period, repFilter]);

  // Totals follow the period and rep filters but NOT the paid/unpaid one: the
  // whole point of the table is the pending-vs-paid split, and filtering to
  // "pending" and then showing a paid column of $0.00 would read as a bug.
  const totals = useMemo(
    () =>
      totalsByRep(
        commissions.filter(
          (c) =>
            (period === "all" || c.period === period) &&
            (repFilter === "all" || c.salesRepId === repFilter)
        )
      ),
    [commissions, period, repFilter]
  );

  const pendingTotal = totals.reduce((s, t) => s + t.pending, 0);
  const paidTotal = totals.reduce((s, t) => s + t.paid, 0);

  function openNew() {
    setForm({ ...EMPTY_FORM, period: currentPeriod });
    setRelatedTo("none");
    setError(null);
    setModalOpen(true);
  }

  function openEdit(c: CommissionRow) {
    setForm({
      id: c.id,
      salesRepId: c.salesRepId,
      amount: String(c.amount),
      rate: c.rate != null ? String(c.rate) : "",
      period: c.period,
      note: c.note ?? "",
      jobNumber: c.jobNumber != null ? String(c.jobNumber) : "",
      leadId: c.leadId ?? "",
    });
    setRelatedTo(c.jobNumber != null ? "job" : c.leadId ? "lead" : "none");
    setError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await saveCommission({
      id: form.id || undefined,
      salesRepId: form.salesRepId,
      amount: form.amount,
      rate: form.rate,
      period: form.period,
      note: form.note,
      jobNumber: relatedTo === "job" ? form.jobNumber : null,
      leadId: relatedTo === "lead" ? form.leadId : null,
    });
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setModalOpen(false);
    // An edit replaces its own row; a new entry is appended and re-sorted into
    // the loader's order. Both go in before the refresh.
    const saved = result.row;
    onCommissionsChange(sortLedger([...commissions.filter((c) => c.id !== saved.id), saved]));
    router.refresh();
  }

  async function togglePaid(c: CommissionRow) {
    setBusyId(c.id);
    const result = await setCommissionPaid(c.id, !c.paidAt);
    setBusyId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onCommissionsChange(
      commissions.map((x) => (x.id === c.id ? { ...x, paidAt: result.paidAt } : x))
    );
    router.refresh();
  }

  async function payRep(ids: string[], repId: string) {
    setBusyId(repId);
    const result = await markCommissionsPaid(ids);
    setBusyId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // Mirror the action's `paidAt: null` guard: an entry already paid keeps the
    // date it was actually paid on.
    const marked = new Set(ids);
    onCommissionsChange(
      commissions.map((c) =>
        marked.has(c.id) && !c.paidAt ? { ...c, paidAt: result.paidAt } : c
      )
    );
    router.refresh();
  }

  async function remove(id: string) {
    setBusyId(id);
    const result = await deleteCommission(id);
    setBusyId(null);
    setConfirmDeleteId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onCommissionsChange(commissions.filter((c) => c.id !== id));
    router.refresh();
  }

  return (
    <div className="stack-16">
      <div className="sl-tab-bar">
        <span className="sl-tab-hint">
          {commissions.length} entr{commissions.length === 1 ? "y" : "ies"} ·{" "}
          {commissionMoney(pendingTotal)} pending
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={openNew}>
          <Plus size={14} /> Record commission
        </button>
      </div>

      {error && <div className="banner banner-amber">{error}</div>}

      {commissions.length === 0 ? (
        <div className="dcard sl-empty">
          <BadgeDollarSign size={28} className="sl-empty-icon" />
          <p style={{ fontSize: 14, color: "var(--primary-70)", fontWeight: 500 }}>
            No commissions recorded
          </p>
          <p style={{ fontSize: 12.5, color: "var(--primary-50)", marginTop: 4, maxWidth: 460 }}>
            Record what a sales rep has earned — on a booking, on a lead they brought in, or as a
            flat amount — and this tab totals it per rep and tracks what you&rsquo;ve paid out.
          </p>
        </div>
      ) : (
        <>
          <div className="astat-grid">
            <div className="astat">
              <div className="astat-head"><span>Pending</span><span className="astat-icon"><BadgeDollarSign size={15} /></span></div>
              <div className="astat-value">{commissionMoney(pendingTotal)}</div>
              <div className="astat-delta">owed across {totals.filter((t) => t.pending !== 0).length} rep(s)</div>
            </div>
            <div className="astat">
              <div className="astat-head"><span>Paid</span><span className="astat-icon"><Check size={15} /></span></div>
              <div className="astat-value">{commissionMoney(paidTotal)}</div>
              <div className="astat-delta">
                {period === "all" ? "all periods" : periodLabel(period)}
              </div>
            </div>
            <div className="astat">
              <div className="astat-head"><span>Reps</span><span className="astat-icon"><BadgeDollarSign size={15} /></span></div>
              <div className="astat-value">{totals.length}</div>
              <div className="astat-delta">with commission on record</div>
            </div>
            <div className="astat">
              <div className="astat-head"><span>Entries</span><span className="astat-icon"><BadgeDollarSign size={15} /></span></div>
              <div className="astat-value">{filtered.length}</div>
              <div className="astat-delta">in this view</div>
            </div>
          </div>

          <div className="atoolbar">
            <PremiumSelect
              value={status}
              onChange={(v) => setStatus(v as StatusFilter)}
              size="sm"
              options={[
                { value: "all", label: "All statuses" },
                { value: "pending", label: "Pending" },
                { value: "paid", label: "Paid" },
              ]}
              style={{ width: 150 }}
            />
            <PremiumSelect
              value={period}
              onChange={setPeriod}
              size="sm"
              options={[
                { value: "all", label: "All periods" },
                ...periods.map((p) => ({ value: p, label: periodLabel(p) })),
              ]}
              style={{ width: 170 }}
            />
            <PremiumSelect
              value={repFilter}
              onChange={setRepFilter}
              size="sm"
              options={[
                { value: "all", label: "All reps" },
                ...totals.map((t) => ({ value: t.repId, label: t.repName })),
              ]}
              style={{ width: 190 }}
            />
          </div>

          <div className="atable-wrap">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Sales rep</th>
                    <th>Entries</th>
                    <th>Pending</th>
                    <th>Paid</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {totals.map((t) => (
                    <tr key={t.repId}>
                      <td style={{ fontWeight: 600 }}>{t.repName}</td>
                      <td>{t.entries}</td>
                      <td style={{ color: t.pending ? "var(--amber-700, #b45309)" : undefined, fontWeight: t.pending ? 600 : 400 }}>
                        {commissionMoney(t.pending)}
                      </td>
                      <td>{commissionMoney(t.paid)}</td>
                      <td style={{ fontWeight: 600 }}>{commissionMoney(t.total)}</td>
                      <td style={{ textAlign: "right" }}>
                        {t.pendingIds.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busyId !== null}
                            onClick={() => payRep(t.pendingIds, t.repId)}>
                            {busyId === t.repId ? "Marking…" : `Mark ${t.pendingIds.length} paid`}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="atable-wrap">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Sales rep</th>
                    <th>Amount</th>
                    <th>Earned on</th>
                    <th>Note</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: "40px 16px", textAlign: "center", color: "var(--primary-60)" }}>
                        No commissions in this view.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((c) => (
                      <tr key={c.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{periodLabel(c.period)}</td>
                        <td style={{ fontWeight: 600 }}>{c.salesRepName}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {commissionMoney(c.amount)}
                          {c.rate != null && (
                            <span style={{ color: "var(--primary-50)", fontSize: 11.5 }}> · {c.rate}%</span>
                          )}
                        </td>
                        <td>
                          {c.jobId ? (
                            <a href={`/admin/jobs/${c.jobId}`} className="link" style={{ fontSize: 13 }}>
                              Job #{c.jobNumber}
                            </a>
                          ) : c.leadId ? (
                            <a href="/admin/leads" className="link" style={{ fontSize: 13 }}>
                              Lead · {c.leadLabel}
                            </a>
                          ) : (
                            <span style={{ color: "var(--primary-40)" }}>—</span>
                          )}
                        </td>
                        <td style={{ maxWidth: 260, fontSize: 12.5, color: "var(--primary-70)" }}>
                          {c.note || <span style={{ color: "var(--primary-40)" }}>—</span>}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {c.paidAt ? (
                            <span className="pill pill-emerald">
                              Paid {formatDate(c.paidAt, { month: "short", day: "numeric" })}
                            </span>
                          ) : (
                            <span className="pill pill-amber">Pending</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {confirmDeleteId === c.id ? (
                            <span style={{ display: "inline-flex", gap: 6 }}>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger-ghost btn-sm"
                                disabled={busyId !== null}
                                onClick={() => remove(c.id)}>
                                Delete
                              </button>
                            </span>
                          ) : (
                            <span style={{ display: "inline-flex", gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busyId !== null}
                                onClick={() => togglePaid(c)}
                                title={c.paidAt ? "Move back to pending" : "Mark this commission paid"}>
                                {c.paidAt ? <Undo2 size={13} /> : <Check size={13} />}
                                {c.paidAt ? "Unpay" : "Mark paid"}
                              </button>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>
                                Edit
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                style={{ width: 32, height: 32 }}
                                aria-label="Delete commission"
                                onClick={() => setConfirmDeleteId(c.id)}>
                                <Trash2 size={14} />
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? "Edit commission" : "Record commission"}>
        <div className="stack-16">
          {error && <div className="banner banner-amber">{error}</div>}

          <div className="field">
            <label className="input-label" htmlFor="cm-rep">Sales rep</label>
            <PremiumSelect
              value={form.salesRepId}
              onChange={(v) => setForm((f) => ({ ...f, salesRepId: v }))}
              placeholder="Select a rep"
              options={reps.map((r) => ({ value: r.id, label: r.name }))}
              size="md"
            />
          </div>

          <div className="grid-2">
            <div className="field">
              <label className="input-label" htmlFor="cm-amount">Amount ($)</label>
              <Input
                id="cm-amount"
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
              />
              <p style={{ fontSize: 12, color: "var(--primary-50)", marginTop: 4 }}>
                A negative amount records a clawback.
              </p>
            </div>
            <div className="field">
              <label className="input-label" htmlFor="cm-rate">Rate (%) — optional</label>
              <Input
                id="cm-rate"
                type="number"
                step="0.1"
                value={form.rate}
                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                placeholder="e.g. 10"
              />
              <p style={{ fontSize: 12, color: "var(--primary-50)", marginTop: 4 }}>
                Recorded for the record only — the amount above is what gets paid.
              </p>
            </div>
          </div>

          <div className="field">
            <label className="input-label" htmlFor="cm-period">Period</label>
            <Input
              id="cm-period"
              type="month"
              value={form.period}
              onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
            />
          </div>

          <div className="field">
            <label className="input-label">Earned on — optional</label>
            <PremiumSelect
              value={relatedTo}
              onChange={(v) => setRelatedTo(v as RelatedTo)}
              options={[
                { value: "none", label: "Nothing specific" },
                { value: "job", label: "A job" },
                { value: "lead", label: "A lead" },
              ]}
              size="md"
            />
          </div>

          {relatedTo === "job" && (
            <div className="field">
              <label className="input-label" htmlFor="cm-job">Job number</label>
              <Input
                id="cm-job"
                value={form.jobNumber}
                onChange={(e) => setForm((f) => ({ ...f, jobNumber: e.target.value }))}
                placeholder="e.g. 1550"
              />
            </div>
          )}

          {relatedTo === "lead" && (
            <div className="field">
              <label className="input-label">Lead</label>
              <PremiumSelect
                value={form.leadId}
                onChange={(v) => setForm((f) => ({ ...f, leadId: v }))}
                placeholder="Select a lead"
                options={leadOptions.map((l) => ({ value: l.id, label: l.label }))}
                size="md"
              />
            </div>
          )}

          <div className="field">
            <label className="input-label" htmlFor="cm-note">Note</label>
            <Textarea
              id="cm-note"
              rows={2}
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="What this commission is for"
            />
          </div>

          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : form.id ? "Save changes" : "Record commission"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
