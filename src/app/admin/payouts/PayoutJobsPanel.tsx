"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader, ExternalLink } from "lucide-react";

import {
  getPayoutJobBreakdown,
  type PayoutJobRow,
} from "../actions/getPayoutJobBreakdown";

/**
 * The jobs behind one cleaner's payout (Sept 10, item 9).
 *
 * "Admin should not have to open every job one by one just to understand
 * payroll totals." Each line keeps its components apart — the work, the tip,
 * the parking — and names the rule that produced the pay, so a figure can be
 * checked rather than trusted.
 *
 * Loaded on expand, not with the page: a period holds a dozen payouts and each
 * one recomputes every job in the window. Nobody expands twelve at once, and a
 * payroll page that took a second longer to open for a panel most people never
 * touch would be the wrong trade.
 */
export default function PayoutJobsPanel({
  payoutId,
  jobCount,
}: {
  payoutId: string;
  jobCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PayoutJobRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || rows || loading) return;

    setLoading(true);
    setError(null);
    const res = await getPayoutJobBreakdown(payoutId);
    setLoading(false);
    if (res.success) {
      setRows(res.rows);
      setTotal(res.total);
    } else {
      setError(res.error);
    }
  }

  const money = (n: number) =>
    n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

  return (
    <div className="rounded-b-xl bg-white px-4 pb-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-2 text-xs font-medium text-[#005a63] hover:underline">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {open ? "Hide" : "Show"} the {jobCount} job{jobCount === 1 ? "" : "s"} behind this
      </button>

      {open && (
        <div className="pt-1">
          {loading && (
            <p className="flex items-center gap-2 py-3 text-xs text-[#008C9C]/60">
              <Loader className="h-3 w-3 animate-spin" /> Working out the breakdown…
            </p>
          )}

          {error && <p className="py-3 text-xs text-red-600">{error}</p>}

          {rows && rows.length === 0 && (
            <p className="py-3 text-xs text-[#008C9C]/60">
              No jobs in this period paid this cleaner.
            </p>
          )}

          {rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[#008C9C]/50">
                    <th className="py-2 pr-3 font-medium">Job</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Service</th>
                    <th className="py-2 pr-3 text-right font-medium">Hours</th>
                    <th className="py-2 pr-3 text-right font-medium">Work</th>
                    <th className="py-2 pr-3 text-right font-medium">Tip</th>
                    <th className="py-2 pr-3 text-right font-medium">Parking</th>
                    <th className="py-2 pr-3 text-right font-medium">Total</th>
                    <th className="py-2 font-medium">How it was paid</th>
                  </tr>
                </thead>
                <tbody className="text-[#008C9C]">
                  {rows.map((r) => (
                    <tr key={r.jobId} className="border-t border-[#008C9C]/10">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/admin/jobs/${r.jobId}`}
                          className="inline-flex items-center gap-1 font-medium hover:underline">
                          #{r.jobNumber} {r.clientName}
                          <ExternalLink size={11} />
                        </Link>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {r.date
                          ? new Date(r.date).toLocaleDateString("en-CA", {
                              month: "short",
                              day: "numeric",
                            })
                          : "—"}
                      </td>
                      <td className="py-2 pr-3">{r.serviceType}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.hours.toFixed(2)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(r.base)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(r.tip)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {money(r.parking)}
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                        {money(r.total)}
                      </td>
                      <td className="py-2 text-[#008C9C]/70">{r.basisLabel}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#008C9C]/20 font-semibold">
                    <td className="py-2 pr-3" colSpan={7}>
                      These jobs come to
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              <p className="pt-2 text-[10px] text-[#008C9C]/50">
                Computed with the same function payroll used, so these lines are the
                Base figure above. Adjustments, deductions and reimbursements are
                entered on the payout itself and are not job-level.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
