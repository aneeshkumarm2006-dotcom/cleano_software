"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { JobIssueDTO } from "@/app/admin/actions/jobIssues";
import { setJobIssueStatus } from "@/app/admin/actions/jobIssues";
import {
  JOB_ISSUE_STATUSES,
  JOB_ISSUE_STATUS_LABEL,
  JOB_ISSUE_URGENCY_LABEL,
  MAX_ISSUE_DESCRIPTION,
  parseJobIssueStatus,
  parseJobIssueUrgency,
  type JobIssueStatus,
} from "@/lib/job-issues";

/**
 * Same shape as NotificationsClient's TONE, keyed by urgency rather than by
 * severity: an URGENT issue is the one that reads like an ERROR row there.
 */
const TONE: Record<string, { dot: string; cls: string }> = {
  URGENT: { dot: "bg-red-500", cls: "border-red-200 bg-red-50/40" },
  NORMAL: { dot: "bg-[#008C9C]", cls: "border-gray-200 bg-white" },
};

const STATUS_CHIP: Record<JobIssueStatus, string> = {
  OPEN: "bg-amber-100 text-amber-800",
  ACKNOWLEDGED: "bg-sky-100 text-sky-800",
  RESOLVED: "bg-emerald-100 text-emerald-800",
};

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

type Tab = JobIssueStatus | "ALL";

const TABS: Tab[] = [...JOB_ISSUE_STATUSES, "ALL"];

export default function IssuesClient({
  initial,
  resolverNames = {},
  loadError = null,
}: {
  initial: JobIssueDTO[];
  /** userId → name for `resolvedById`. The DTO carries only the id. */
  resolverNames?: Record<string, string>;
  loadError?: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  // Open first: this page exists to answer "who is stuck right now".
  const [tab, setTab] = useState<Tab>("OPEN");
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const counts = useMemo(() => {
    const map: Record<Tab, number> = { OPEN: 0, ACKNOWLEDGED: 0, RESOLVED: 0, ALL: items.length };
    for (const i of items) map[parseJobIssueStatus(i.status)] += 1;
    return map;
  }, [items]);

  const shown = useMemo(
    () => (tab === "ALL" ? items : items.filter((i) => parseJobIssueStatus(i.status) === tab)),
    [items, tab],
  );

  async function advance(issue: JobIssueDTO, next: JobIssueStatus, resolutionNote?: string) {
    if (busyId) return;
    setBusyId(issue.id);
    setError(null);
    const result = await setJobIssueStatus(issue.id, next, resolutionNote);
    setBusyId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const now = new Date().toISOString();
    // Patched locally as well as refreshed: the row must stop looking open the
    // moment it is clicked, not once the server round trip returns.
    setItems((prev) =>
      prev.map((i) =>
        i.id === issue.id
          ? {
              ...i,
              status: next,
              statusLabel: JOB_ISSUE_STATUS_LABEL[next],
              acknowledgedAt: i.acknowledgedAt ?? now,
              resolvedAt: next === "RESOLVED" ? now : null,
              resolutionNote: next === "RESOLVED" ? (resolutionNote?.trim() || null) : null,
            }
          : i,
      ),
    );
    setResolving(null);
    setNote("");
    startTransition(() => router.refresh());
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/40 p-10 text-center">
        <p className="text-sm text-red-700">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-[#008C9C] bg-[#008C9C] text-white"
                  : "border-neutral-950/15 bg-white text-neutral-950/70 hover:border-[#008C9C]/40"
              }`}>
              {t === "ALL" ? "All" : JOB_ISSUE_STATUS_LABEL[t]}
              <span className={active ? "ml-1.5 opacity-80" : "ml-1.5 opacity-60"}>
                ({counts[t]})
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">
            {tab === "OPEN"
              ? "Nothing open. Anything a cleaner reports from a job — locked out, missing supplies, damage — lands here first."
              : "Nothing in this state."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((issue) => {
            const urgency = parseJobIssueUrgency(issue.urgency);
            const status = parseJobIssueStatus(issue.status);
            const tone = TONE[urgency] ?? TONE.NORMAL;
            const busy = busyId === issue.id;
            return (
              <li key={issue.id}>
                <div className={`flex gap-3 rounded-xl border p-4 ${tone.cls}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                            urgency === "URGENT"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-600"
                          }`}>
                          {JOB_ISSUE_URGENCY_LABEL[urgency]}
                        </span>
                        <span className="font-semibold text-gray-900">
                          {issue.categoryLabel}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[status]}`}>
                          {JOB_ISSUE_STATUS_LABEL[status]}
                        </span>
                      </div>
                      <span className="text-xs tabular-nums text-gray-500">
                        {ago(issue.createdAt)}
                      </span>
                    </div>

                    <p className="text-sm text-gray-600">
                      {issue.reportedByName} ·{" "}
                      <Link
                        href={`/admin/jobs/${issue.jobId}`}
                        className="text-[#008C9C] hover:underline">
                        #{issue.jobNumber} {issue.clientName}
                      </Link>
                    </p>

                    <p className="whitespace-pre-wrap text-sm text-gray-800">
                      {issue.description}
                    </p>

                    {issue.photoUrl && (
                      <a href={issue.photoUrl} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={issue.photoUrl}
                          alt={`Photo attached to the ${issue.categoryLabel} report`}
                          className="h-24 w-24 rounded-lg border border-gray-200 object-cover"
                        />
                      </a>
                    )}

                    {status === "RESOLVED" && (
                      <p className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-900">
                        Resolved by{" "}
                        {(issue.resolvedById && resolverNames[issue.resolvedById]) || "an admin"}
                        {issue.resolvedAt ? ` ${ago(issue.resolvedAt)}` : ""}
                        {issue.resolutionNote ? ` — ${issue.resolutionNote}` : "."}
                      </p>
                    )}

                    {resolving === issue.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          maxLength={MAX_ISSUE_DESCRIPTION}
                          rows={2}
                          placeholder="What was done about it? (optional)"
                          className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:border-[#008C9C]/40 focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void advance(issue, "RESOLVED", note)}
                            className="rounded-full bg-[#008C9C] px-3 py-1.5 text-sm text-white disabled:opacity-60">
                            {busy ? "Resolving…" : "Confirm resolved"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setResolving(null);
                              setNote("");
                            }}
                            className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-600 disabled:opacity-60">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      status !== "RESOLVED" && (
                        <div className="flex gap-2">
                          {status === "OPEN" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void advance(issue, "ACKNOWLEDGED")}
                              className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-[#008C9C]/40 disabled:opacity-60">
                              {busy ? "Working…" : "Acknowledge"}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setResolving(issue.id);
                              setNote("");
                            }}
                            className="rounded-full bg-[#008C9C] px-3 py-1.5 text-sm text-white disabled:opacity-60">
                            Resolve
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
