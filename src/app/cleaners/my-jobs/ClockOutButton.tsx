"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { clockOut } from "@/app/admin/actions/clockOut";
import {
  CHECKLIST_GATE_HINT,
  pendingRequiredItems,
} from "@/lib/job-checklist";
import type { ClosingReport } from "@/lib/clock-out";
import ClosingInventoryReport, {
  answeredCount,
  buildReport,
  type ClosingReportDraft,
  type ClosingReportItem,
} from "./ClosingInventoryReport";
import {
  ClockOutErrorNotice,
  type ClockOutErrorState,
} from "./ClockOutError";

interface ClockOutButtonProps {
  jobId: string;
  /** This cleaner's kit, as the closing report needs to see it (Stage 3). */
  employeeProducts: ClosingReportItem[];
  /**
   * The job's checklist, already generated server-side (item 12.a).
   *
   * This button had NO checklist gate at all while the clock screen's button
   * did — and this is the one rendered on the job detail page, so the "required
   * items block clock-out" rule was bypassable by using the more obvious of the
   * two buttons. Passed in rather than fetched: the page has already ensured it.
   */
  checklistItems?: { id: string; title: string; isRequired: boolean; status: string; notes: string | null }[];
}

/**
 * Clock out from the job detail page.
 *
 * The inventory half of this modal is `ClosingInventoryReport` — ONE component,
 * shared with the clock screen. Before Stage 3 each screen carried its own copy
 * of the estimated-usage pickers (SPRAY_OPTIONS, MOP_OPTIONS, DISPOSABLE_OPTIONS
 * and a local `ML_PER_SPRAY = 1.25`), which is how they drifted apart.
 */
export default function ClockOutButton({
  jobId,
  employeeProducts,
  checklistItems = [],
}: ClockOutButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<ClockOutErrorState | null>(null);
  /**
   * The payload of the attempt that failed, kept so Retry resubmits exactly what
   * was sent rather than re-reading state the cleaner might have nudged in the
   * meantime (PDF: "retry after an API failure without re-entering the
   * submission"). The modal never resets its inputs on failure, so the answers
   * are still on screen either way — this is about sending the SAME ones.
   */
  const [lastPayload, setLastPayload] = useState<ClosingReport | null>(null);

  // The closing report: has the cleaner opened it, and what have they answered.
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ClosingReportDraft>>({});

  function handleOpen() {
    setEditing(false);
    setDrafts({});
    setFailure(null);
    setLastPayload(null);
    setOpen(true);
  }

  async function submit(report: ClosingReport) {
    // Re-entry guard. The button is disabled while in flight, but a double tap
    // on a laggy phone can land two events before React re-renders it, and two
    // clock-outs of one session is not something to leave to CSS.
    if (loading) return;
    setLoading(true);
    setFailure(null);
    setLastPayload(report);
    try {
      const result = await clockOut(jobId, report);
      if (result.success) {
        setOpen(false);
      } else {
        setFailure(result);
      }
    } catch (e) {
      // The action itself no longer throws; this is the network dying between
      // the phone and the server, which is exactly a Retry case.
      console.error("clock-out", e);
      setFailure({
        code: "DB_UNAVAILABLE",
        error:
          "We couldn't reach the server. Check your signal and tap Retry — your entries are still here.",
        retryable: true,
      });
    } finally {
      setLoading(false);
    }
  }

  const buildUsage = () => buildReport(drafts);
  const handleConfirm = () => submit(buildUsage());
  const handleRetry = () => submit(lastPayload ?? buildUsage());

  const reported = answeredCount(drafts);

  // The gate, from the same predicate the clock screen uses. An empty checklist
  // gates nothing, so jobs with no configured template are unaffected.
  const outstandingRequired = pendingRequiredItems(checklistItems);
  const gateBlocked = outstandingRequired.length > 0;

  const modal = open ? (
    <div className="co-overlay" onClick={() => !loading && setOpen(false)}>
      <div className="co-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="co-head">
          <div className="co-head-left">
            <span className="co-head-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </span>
            <div>
              <h2 className="co-title">Closing inventory</h2>
              <p className="co-subtitle">
                Report anything that changed. Nothing is deducted automatically.
              </p>
            </div>
          </div>
          <button className="co-close" onClick={() => !loading && setOpen(false)} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="co-body">
          <ClosingInventoryReport
            items={employeeProducts}
            drafts={drafts}
            onChange={setDrafts}
            editing={editing}
            onEditingChange={setEditing}
            failure={failure}
            disabled={loading}
          />
        </div>

        {failure && (
          <ClockOutErrorNotice
            state={failure}
            onRetry={handleRetry}
            retrying={loading}
          />
        )}

        {/* Required checklist items still outstanding — the gate. Named, not
            just counted, so the cleaner knows what to go and do. */}
        {gateBlocked && (
          <div style={{
            margin: "0 0 12px",
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "#b45309",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 10,
            padding: "10px 12px",
          }}>
            <strong>
              {outstandingRequired.length} required checklist item
              {outstandingRequired.length === 1 ? "" : "s"} still pending.
            </strong>{" "}
            Tick {outstandingRequired.length === 1 ? "it" : "them"} off on the job
            page before clocking out:{" "}
            {outstandingRequired.map((i) => i.title).join(", ")}.
          </div>
        )}

        {/* Footer. The confirm button IS the "No changes" fast path until the
            cleaner opens the report — one tap, from the sheet's first screen. */}
        <div className="co-footer">
          <button className="co-btn-ghost" onClick={() => !loading && setOpen(false)} disabled={loading}>
            Cancel
          </button>
          <button
            className="co-btn-confirm"
            onClick={handleConfirm}
            disabled={loading || gateBlocked}
            title={gateBlocked ? CHECKLIST_GATE_HINT : undefined}>
            {loading ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "co-spin 0.8s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Submitting…
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {editing
                  ? reported > 0
                    ? `Save ${reported} update${reported === 1 ? "" : "s"} & clock out`
                    : "Clock out"
                  : "No changes — clock out"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button className="cl-jd-clock out" onClick={handleOpen}>
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        Clock Out
      </button>
      {typeof window !== "undefined" && modal
        ? createPortal(modal, document.body)
        : null}
    </>
  );
}
