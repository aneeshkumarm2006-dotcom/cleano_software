"use client";

import { useMemo, useState, useTransition } from "react";
import { CreditCard, CheckCircle, XCircle, Zap } from "lucide-react";
import { bulkChargeJobs } from "../actions/bulkChargeJobs";

interface BulkJob {
  id: string;
  jobNumber: number;
  clientName: string;
  jobType: string | null;
  amount: number;
  completedAt: string | null;
  hasCardOnFile: boolean;
}

interface Props {
  jobs: BulkJob[];
}

type BatchResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  totalCharged: number;
  results: Array<{
    jobId: string;
    jobNumber: number;
    clientName: string;
    success: boolean;
    amount?: number;
    error?: string;
  }>;
};

function fmtAmount(n: number) {
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function BulkChargeClient({ jobs }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [pending, startTransition] = useTransition();

  const eligible = useMemo(() => jobs.filter((j) => j.hasCardOnFile), [jobs]);
  const allSelected = eligible.length > 0 && selected.size === eligible.length;
  const selectedTotal = useMemo(
    () =>
      jobs
        .filter((j) => selected.has(j.id))
        .reduce((sum, j) => sum + j.amount, 0),
    [jobs, selected]
  );
  const totalValue = useMemo(
    () => eligible.reduce((s, j) => s + j.amount, 0),
    [eligible]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(eligible.map((j) => j.id)));
  }

  function runBatch() {
    if (selected.size === 0) return;
    startTransition(async () => {
      const result = await bulkChargeJobs(Array.from(selected));
      if (result.success) {
        setBatch({
          attempted: result.attempted ?? 0,
          succeeded: result.succeeded ?? 0,
          failed: result.failed ?? 0,
          totalCharged: result.totalCharged ?? 0,
          results: result.results ?? [],
        });
        setSelected(new Set());
      } else {
        alert(result.error ?? "Bulk charge failed");
      }
    });
  }

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Finance</p>
        <h1 className="display">Bulk Charge</h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)" }}>
          Completed jobs that are unpaid and have a card on file. Select rows and run them in one batch.
        </p>
      </header>

      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head">
            <span>Eligible jobs</span>
            <span className="astat-icon"><CreditCard size={15} /></span>
          </div>
          <div className="astat-value">{eligible.length}</div>
          <div className="astat-delta">{jobs.length - eligible.length} no card on file</div>
        </div>
        <div className="astat">
          <div className="astat-head">
            <span>Chargeable total</span>
            <span className="astat-icon"><Zap size={15} /></span>
          </div>
          <div className="astat-value">{fmtAmount(totalValue)}</div>
          <div className="astat-delta">across {eligible.length} jobs</div>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          Nothing to charge. All completed jobs are either paid or marked as cash.
        </div>
      ) : (
        <>
          <div className="atoolbar">
            <div style={{ fontSize: 13, color: "var(--primary-70)", fontWeight: 600 }}>
              {selected.size > 0
                ? `${selected.size} selected · ${fmtAmount(selectedTotal)} total`
                : `${eligible.length} eligible jobs`}
            </div>
            <div style={{ marginLeft: "auto" }}>
              <button
                type="button"
                disabled={selected.size === 0 || pending}
                onClick={runBatch}
                className="btn btn-primary"
                style={{ opacity: selected.size === 0 || pending ? 0.5 : 1 }}>
                <Zap size={15} />
                {pending ? "Charging…" : `Charge ${selected.size} job${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          <div className="atable-wrap">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th style={{ width: 40, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all eligible"
                      />
                    </th>
                    <th>Job</th>
                    <th>Client</th>
                    <th>Service</th>
                    <th>Completed</th>
                    <th className="num">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const disabled = !j.hasCardOnFile;
                    return (
                      <tr key={j.id} style={{ opacity: disabled ? 0.5 : 1 }}>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={selected.has(j.id)}
                            onChange={() => toggle(j.id)}
                          />
                        </td>
                        <td>
                          <span className="col-client">#{j.jobNumber}</span>
                        </td>
                        <td>
                          <span className="col-client">{j.clientName}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: "var(--primary-60)" }}>{j.jobType ?? "—"}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: "var(--primary-60)" }}>{fmtDate(j.completedAt)}</span>
                        </td>
                        <td className="num" style={{ fontWeight: 700 }}>
                          {fmtAmount(j.amount)}
                        </td>
                        <td>
                          {disabled && (
                            <span style={{ fontSize: 11, color: "var(--primary-40)" }}>No card on file</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {batch && (
        <div className="atable-wrap" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Batch complete</h3>
            {batch.failed === 0
              ? <CheckCircle size={18} style={{ color: "#15803d" }} />
              : <XCircle size={18} style={{ color: "#dc2626" }} />}
          </div>
          <p style={{ marginTop: 0, fontSize: 13, color: "var(--primary-70)" }}>
            Charged {fmtAmount(batch.totalCharged)} across {batch.succeeded} of {batch.attempted} jobs.{" "}
            {batch.failed > 0 && (
              <span style={{ color: "#dc2626", fontWeight: 600 }}>{batch.failed} failed.</span>
            )}
          </p>
          <ul style={{ marginTop: 12, fontSize: 13, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            {batch.results.map((r) => (
              <li key={r.jobId}>
                #{r.jobNumber} — {r.clientName}:{" "}
                {r.success ? (
                  <span style={{ color: "var(--primary)", fontWeight: 600 }}>Charged {fmtAmount(r.amount ?? 0)}</span>
                ) : (
                  <span style={{ color: "#dc2626" }}>{r.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
