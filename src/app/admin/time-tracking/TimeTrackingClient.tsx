"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, Loader, Timer, Users } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Select from "@/components/ui/Select";
import { fmtDate, fmtTime } from "@/lib/time";
import { getClockActivity } from "../actions/getClockActivity";
import ClockTimeEditor from "../jobs/[id]/ClockTimeEditor";
import type { ClockActivityEntry } from "../actions/getClockActivity.types";
import {
  CLOCK_STATUS_LABEL,
  formatWorkedDuration,
  type ClockStatus,
} from "@/lib/time-tracking";

interface Props {
  cleaners: { id: string; name: string }[];
}

const STATUS_STYLE: Record<ClockStatus, { bg: string; color: string }> = {
  NOT_STARTED: { bg: "#f1f5f9", color: "#475569" },
  ON_THE_WAY: { bg: "#fffbeb", color: "#b45309" },
  CLOCKED_IN: { bg: "#dcfce7", color: "#15803d" },
  CLOCKED_OUT: { bg: "#eff6ff", color: "#1d4ed8" },
  COMPLETED: { bg: "#eff6ff", color: "#1d4ed8" },
  CANCELLED: { bg: "#fee2e2", color: "#b91c1c" },
};

/**
 * Centralised clock-in / clock-out activity (awer_fixes.pdf item 12).
 * Lazy-loaded in pages — this grows with every job worked.
 */
export default function TimeTrackingClient({ cleaners }: Props) {
  const [entries, setEntries] = useState<ClockActivityEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleanerId, setCleanerId] = useState("");
  const [filter, setFilter] = useState<"all" | "open">("all");
  const [totals, setTotals] = useState({ openShifts: 0, staleShifts: 0 });

  // Stops a slow first page from appending stale rows after a filter change.
  const requestRef = useRef(0);

  const load = useCallback(
    async (opts: { reset?: boolean } = {}) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      setError(null);

      const res = await getClockActivity({
        cursor: opts.reset ? null : cursor,
        cleanerId: cleanerId || null,
        filter,
      });

      if (requestId !== requestRef.current) return;
      setLoading(false);

      if (!res.success) {
        setError(res.error);
        return;
      }
      setEntries((prev) =>
        opts.reset ? res.page.entries : [...prev, ...res.page.entries]
      );
      setCursor(res.page.nextCursor);
      setHasMore(res.page.nextCursor !== null);
      setTotals(res.page.totals);
    },
    [cursor, cleanerId, filter]
  );

  useEffect(() => {
    setEntries([]);
    setCursor(null);
    setHasMore(true);
    load({ reset: true });
    // `load` closes over `cursor`, which this effect resets — including it
    // would re-fire on every page fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanerId, filter]);

  return (
    <div className="space-y-6 admin-font">
      <header className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Staff · Time tracking</p>
          <h1 className="display" style={{ fontSize: "clamp(28px, 3.2vw, 38px)" }}>
            Clock-in activity
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={cleanerId}
            onChange={setCleanerId}
            size="sm"
            options={[
              { value: "", label: "All employees" },
              ...cleaners.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            value={filter}
            onChange={(v) => setFilter(v as "all" | "open")}
            size="sm"
            options={[
              { value: "all", label: "All activity" },
              { value: "open", label: "Still clocked in" },
            ]}
          />
        </div>
      </header>

      {/* Stats across the whole filtered set, not just the loaded page. */}
      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head">
            <span className="astat-label">Currently clocked in</span>
            <div className="astat-icon"><Clock size={15} /></div>
          </div>
          <div className="astat-value">{totals.openShifts}</div>
          <div className="astat-delta">Open shifts right now</div>
        </div>
        <button
          type="button"
          onClick={() => setFilter("open")}
          className="astat"
          style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}
          title="Shifts open far longer than a plausible working day">
          <div className="astat-head">
            <span className="astat-label">Missed clock-outs</span>
            <div className="astat-icon"><AlertTriangle size={15} /></div>
          </div>
          <div className="astat-value">{totals.staleShifts}</div>
          <div className="astat-delta">
            {totals.staleShifts > 0 ? "Review before payroll" : "None outstanding"}
          </div>
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {entries.length === 0 && !loading && !error ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-[#008C9C]/5 rounded-full flex items-center justify-center mx-auto mb-3">
            <Timer className="w-8 h-8 text-[#008C9C]/40" />
          </div>
          <p className="text-sm font-[350] text-[#008C9C]/70">
            No clock activity yet
          </p>
          <p className="text-xs font-[350] text-[#008C9C]/60 mt-1">
            Clock-ins appear here as soon as cleaners start their jobs
          </p>
        </div>
      ) : (
        <div className="border border-[#008C9C]/10 rounded-xl divide-y divide-[#008C9C]/10 overflow-x-auto">
          {entries.map((e) => {
            const style = STATUS_STYLE[e.status];
            return (
              <div
                key={e.id}
                className="flex items-start gap-4 px-4 py-3 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      style={{
                        background: style.bg,
                        color: style.color,
                        fontSize: 10,
                        fontWeight: 700,
                        borderRadius: 20,
                        padding: "2px 8px",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}>
                      {CLOCK_STATUS_LABEL[e.status]}
                    </span>
                    <span className="text-sm text-[#008C9C] inline-flex items-center gap-1 truncate">
                      <Users className="w-3.5 h-3.5 flex-shrink-0" />
                      {e.cleanerName}
                    </span>
                    {e.isOnBreak && (
                      <Badge variant="warning" size="sm">
                        On break
                      </Badge>
                    )}
                    {e.isStale && (
                      <Badge variant="error" size="sm">
                        Missed clock-out
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-[#008C9C]/60 mt-1">
                    <Link
                      href={`/admin/jobs/${e.jobId}`}
                      className="hover:underline">
                      Job #{e.jobNumber} · {e.clientName}
                    </Link>
                    {" · "}
                    {fmtDate(e.scheduledStart, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {e.isLegacy && " · job-level record"}
                  </div>

                  {/* Session log (awerfixes.pdf item 6) — a cleaner can clock
                      out and back in, so the In/Out columns to the right are
                      the first and last of these, and the duration is their
                      SUM. Only shown when there is more than one, otherwise
                      it just repeats the columns. */}
                  {e.sessions.length > 1 && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      {e.sessions.map((s, i) => (
                        <div
                          key={s.id}
                          className="text-[11px] text-[#008C9C]/70 tabular-nums flex items-center gap-2 flex-wrap">
                          <span className="text-[#008C9C]/50">Session {i + 1}</span>
                          <span className="font-[500]">
                            {fmtTime(s.startedAt)} →{" "}
                            {s.endedAt ? fmtTime(s.endedAt) : "now"}
                          </span>
                          <span>{formatWorkedDuration(s.activeMinutes)}</span>
                          <ClockTimeEditor
                            jobId={e.jobId}
                            sessionId={s.id}
                            cleanerId={e.cleanerId}
                            cleanerName={e.cleanerName}
                            clockInTime={s.startedAt}
                            clockOutTime={s.endedAt}
                            label="Edit"
                            onSaved={() => {
                              setEntries([]);
                              setCursor(null);
                              setHasMore(true);
                              load({ reset: true });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="text-xs text-[#008C9C]/70 flex-shrink-0 tabular-nums">
                  <div>
                    In: {e.clockInTime ? fmtTime(e.clockInTime) : "—"}
                  </div>
                  <div>
                    Out: {e.clockOutTime ? fmtTime(e.clockOutTime) : "—"}
                  </div>
                  {/* Item 4: correct a missed clock-in / wrong clock-out from
                      the time-tracking view as well as the job page. A legacy
                      row has no assignment, so it edits the job-level fields.
                      Item 6: with exactly one session, editing it IS editing
                      the pair; with several, the per-session editors above are
                      the only honest place to do it (the columns here are
                      derived, and the server refuses to write them directly). */}
                  <div className="mt-1">
                    {e.sessions.length > 1 ? (
                      <span className="text-[11px] text-[#008C9C]/50">
                        Edit per session
                      </span>
                    ) : (
                      <ClockTimeEditor
                        jobId={e.jobId}
                        sessionId={e.sessions[0]?.id ?? null}
                        cleanerId={e.isLegacy ? null : e.cleanerId}
                        cleanerName={e.isLegacy ? null : e.cleanerName}
                        clockInTime={e.clockInTime}
                        clockOutTime={e.clockOutTime}
                        label="Edit"
                        onSaved={() => {
                          setEntries([]);
                          setCursor(null);
                          setHasMore(true);
                          load({ reset: true });
                        }}
                      />
                    )}
                  </div>
                </div>

                <div className="text-right flex-shrink-0 w-28">
                  {/* Item 26: ACTIVE time is the headline, because that is what
                      payroll pays. Break time is shown beneath so the elapsed
                      figure is still auditable. */}
                  <div className="text-sm font-[500] text-[#008C9C] tabular-nums">
                    {e.activeMinutes !== null
                      ? formatWorkedDuration(e.activeMinutes)
                      : e.openMinutes !== null
                      ? formatWorkedDuration(e.openMinutes)
                      : "—"}
                  </div>
                  <div className="text-[11px] text-[#008C9C]/50">
                    {e.activeMinutes !== null
                      ? "active"
                      : e.openMinutes !== null
                      ? "elapsed"
                      : ""}
                  </div>
                  {e.breakMinutes > 0 && (
                    <div className="text-[11px] text-amber-700 tabular-nums">
                      +{formatWorkedDuration(e.breakMinutes)} break
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && entries.length > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="btn btn-secondary btn-sm">
            {loading ? (
              <>
                <Loader className="w-3.5 h-3.5 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              "Load more"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
