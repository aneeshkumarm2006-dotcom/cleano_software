"use client";

// The Time Log Change Requests subsection (Sept 17 list, item 19, which asks
// for it here by name: "add a subsection in Notifications for Time Log Change
// Requests").
//
// It sits above the feed rather than in it. A feed entry is something that has
// already happened and needs reading; these are things that have NOT happened
// and need deciding, and a cleaner is waiting on each one. Mixing them into a
// list of past events is how a request sits unanswered for a week.

import { useState, useTransition } from "react";
import Link from "next/link";

import {
  decideTimeLogChange,
  type TimeLogRequestRow,
} from "../actions/decideTimeLogChange";

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "none";

/** "Start: 8:45 AM → 9:15 AM", or null when this side is unchanged. */
function changeLine(
  label: string,
  original: string | null,
  requested: string | null,
): string | null {
  if (!requested) return null;
  if (original && Math.floor(new Date(original).getTime() / 60_000) ===
      Math.floor(new Date(requested).getTime() / 60_000)) {
    return null;
  }
  return `${label}: ${fmt(original)} → ${fmt(requested)}`;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-gray-50 text-gray-600 border-gray-200",
};

export default function TimeLogRequestsPanel({
  rows,
  showingHistory,
}: {
  rows: TimeLogRequestRow[];
  showingHistory: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const waiting = rows.filter((r) => r.status === "PENDING").length;

  function decide(requestId: string, approve: boolean, withNote?: string) {
    startTransition(async () => {
      setMsg(null);
      const res = await decideTimeLogChange({ requestId, approve, note: withNote });
      if (res.success) {
        setMsg({
          kind: "ok",
          text: approve
            ? "Approved. The hours and the payroll figure are updated."
            : "Rejected. The time log is unchanged.",
        });
        setNoteFor(null);
        setNote("");
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  }

  // Nothing waiting and not looking at history: say nothing at all rather than
  // adding an empty box to every visit to this page.
  if (rows.length === 0 && !showingHistory) return null;

  return (
    <section className="mb-8 rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-[600] text-gray-900">
            Time log change requests
            {waiting > 0 && (
              <span className="ml-2 text-xs font-[600] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                {waiting} waiting
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            A cleaner asking for their clock to be corrected. Approving applies
            it to their hours and to payroll.
          </p>
        </div>
        <Link
          href={
            showingHistory
              ? "/admin/notifications"
              : "/admin/notifications?timelog=all"
          }
          className="text-xs font-[600] text-[#008C9C] hover:underline whitespace-nowrap">
          {showingHistory ? "Only waiting" : "History"}
        </Link>
      </div>

      {msg && (
        <p
          role="status"
          className={`px-4 pt-3 text-xs ${msg.kind === "ok" ? "text-green-600" : "text-red-500"}`}>
          {msg.text}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-4 text-xs text-gray-500">
          No requests yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => {
            const lines = [
              changeLine("Start", r.originalStart, r.requestedStart),
              changeLine("Finish", r.originalEnd, r.requestedEnd),
            ].filter(Boolean) as string[];
            return (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-[600] text-gray-900">
                        {r.cleanerName ?? "A cleaner"}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border font-[600] uppercase tracking-wide ${STATUS_STYLE[r.status] ?? STATUS_STYLE.REJECTED}`}>
                        {r.status.toLowerCase()}
                      </span>
                      {r.jobNumber != null && (
                        <Link
                          href={`/admin/jobs/${r.jobId}`}
                          className="text-xs text-[#008C9C] hover:underline">
                          Job #{r.jobNumber}
                          {r.clientName ? ` · ${r.clientName}` : ""}
                        </Link>
                      )}
                    </div>

                    {/* The original and the requested time, side by side. The
                        PDF asks for both to be kept, and an admin cannot judge
                        a request without seeing what it is changing FROM. */}
                    <ul className="mt-1 text-xs text-gray-700 tabular-nums">
                      {lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>

                    <p className="mt-1 text-xs text-gray-600 italic">
                      &quot;{r.reason}&quot;
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      Asked {fmt(r.createdAt)}
                      {r.decidedAt
                        ? ` · ${r.status.toLowerCase()} ${fmt(r.decidedAt)}${r.decidedByName ? ` by ${r.decidedByName}` : ""}`
                        : ""}
                    </p>
                    {r.decisionNote && (
                      <p className="mt-0.5 text-[11px] text-gray-600">
                        Reply: {r.decisionNote}
                      </p>
                    )}
                  </div>

                  {r.status === "PENDING" && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => decide(r.id, true)}
                        className="px-3 py-1.5 text-xs font-[600] rounded-lg bg-[#008C9C] text-white hover:bg-[#008C9C]/90 disabled:opacity-50">
                        {pending ? "…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setNoteFor(noteFor === r.id ? null : r.id);
                          setNote("");
                          setMsg(null);
                        }}
                        className="px-3 py-1.5 text-xs font-[600] rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {/* A rejection is answered, not just refused. The cleaner sees
                    this note, and "no" with no reason is how the next request
                    becomes an argument. */}
                {noteFor === r.id && (
                  <div className="mt-2 flex items-start gap-2">
                    <input
                      type="text"
                      autoFocus
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Why not? The cleaner sees this."
                      aria-label="Reason for rejecting"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => decide(r.id, false, note)}
                      className="px-3 py-1.5 text-xs font-[600] rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50">
                      {pending ? "…" : "Confirm"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
