"use client";

// Clocks nobody stopped.
//
// It sits beside the Time Log Change Requests section and is built to the same
// shape on purpose: both are queues of things that have NOT happened and need a
// person, as opposed to the feed below, which is a record of things that have.
//
// The difference is who is waiting. A time-log request has a cleaner waiting on
// an answer. Nobody is waiting on this one, which is exactly why it ran for
// thirty-four days — so the row has to carry its own urgency, and it does that
// by saying what the number will be if it is left alone.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";

import { closeStaleClock } from "../actions/closeStaleClock";
import type { StaleClockRow } from "@/lib/stale-clock.server";
import { storeInputParts, storeTz, storeWallClockToUtc } from "@/lib/timezone";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    // The JOB's clock, not the browser's. Without this the label read one
    // timezone while the date/time inputs beside it — which go through
    // storeInputParts — read another, so "clocked in 10:50 AM" sat next to a
    // prefilled finish of 04:20 AM and neither was wrong on its own.
    timeZone: storeTz(),
  });

const SEVERITY_STYLE: Record<string, string> = {
  forgotten: "bg-amber-50 text-amber-800 border-amber-200",
  abandoned: "bg-red-50 text-red-700 border-red-200",
};

const SEVERITY_LABEL: Record<string, string> = {
  forgotten: "left running",
  abandoned: "abandoned",
};

function Row({
  row,
  onDone,
}: {
  row: StaleClockRow;
  onDone: (id: string, msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Prefilled with the guess, in the JOB's clock, because every other time on
  // this page is printed in it. Reading these back with `new Date("...")` would
  // interpret them as the admin's own local time, so an admin in another
  // province would save an hour they never chose.
  const initial = useMemo(
    () => storeInputParts(new Date(row.suggestedEnd ?? row.startedAt)),
    [row.suggestedEnd, row.startedAt],
  );
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  function submit() {
    startTransition(async () => {
      setError(null);
      if (!date || !time) {
        setError("Pick the date and time they finished.");
        return;
      }
      const res = await closeStaleClock({
        sessionId: row.sessionId,
        endedAt: storeWallClockToUtc(date, time).toISOString(),
      });
      if (res.success) {
        onDone(
          row.sessionId,
          res.warning
            ? `Closed. ${res.warning}`
            : "Closed. The hours and the payroll figure are updated.",
        );
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-[600] text-gray-900">
              {row.cleanerName ?? "A cleaner"}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border font-[600] uppercase tracking-wide ${
                SEVERITY_STYLE[row.severity] ?? SEVERITY_STYLE.forgotten
              }`}>
              {SEVERITY_LABEL[row.severity] ?? row.severity}
            </span>
            {row.jobNumber != null && (
              <Link
                href={`/admin/jobs/${row.jobId}`}
                className="text-xs text-[#008C9C] hover:underline">
                Job #{row.jobNumber}
                {row.clientName ? ` · ${row.clientName}` : ""}
              </Link>
            )}
          </div>

          <p className="mt-1 text-xs text-gray-700 tabular-nums">
            Clocked in {fmt(row.startedAt)} · still running after{" "}
            <span className="font-[600]">{row.openFor}</span>
          </p>

          {/* The whole reason this is urgent. An open session is measured to
              now, so the figure grows every day it is ignored, and it is the
              figure payroll reads. */}
          <p className="mt-0.5 text-[11px] text-gray-500">
            Until this is closed it counts as {row.openFor} of work.
            {row.jobEndTime
              ? ` The job was due to finish ${fmt(row.jobEndTime)}.`
              : " The job has no scheduled finish, so the time below is a guess."}
          </p>
        </div>

        <div className="flex items-end gap-2 shrink-0 flex-wrap">
          <label className="text-[10px] font-[600] text-gray-500 uppercase tracking-wide">
            Finished
            <div className="flex gap-1.5 mt-1">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label={`Finish date for ${row.cleanerName ?? "this cleaner"}`}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                aria-label={`Finish time for ${row.cleanerName ?? "this cleaner"}`}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
              />
            </div>
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="px-3 py-1.5 text-xs font-[600] rounded-lg bg-[#008C9C] text-white hover:bg-[#008C9C]/90 disabled:opacity-50">
            {pending ? "…" : "Close clock"}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {error}
        </p>
      )}
    </li>
  );
}

export default function StaleClocksPanel({
  rows,
  compact = false,
}: {
  rows: StaleClockRow[];
  /**
   * One line pointing at Time tracking, instead of the whole queue.
   *
   * The queue's home is Time tracking — a clock still running is work in
   * progress, and that is the page an admin is on when they deal with it.
   * Notifications keeps the entry point because that is where an admin
   * arrives from the email, but repeating the full editor on both pages
   * would be two places to fix the same thing.
   */
  compact?: boolean;
}) {
  const [closed, setClosed] = useState<Record<string, string>>({});
  const remaining = rows.filter((r) => !closed[r.sessionId]);

  // Nothing running late: say nothing at all rather than adding an empty box to
  // every visit to this page.
  if (rows.length === 0) return null;

  if (compact) {
    const worst = rows[0];
    return (
      <Link
        href="/admin/time-tracking"
        className="mb-8 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100">
        <span className="text-xs font-[600] px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900">
          {rows.length}
        </span>
        <span className="text-sm text-amber-900">
          <strong>
            {rows.length === 1 ? "A clock is" : `${rows.length} clocks are`} still running.
          </strong>{" "}
          The longest has been open {worst.openFor} and counts as that much work.
        </span>
        <span className="ml-auto text-xs font-[600] text-amber-900 whitespace-nowrap">
          Close them in Time tracking →
        </span>
      </Link>
    );
  }

  return (
    <section className="mb-8 rounded-xl border border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-[600] text-gray-900">
          Clocks still running
          {remaining.length > 0 && (
            <span className="ml-2 text-xs font-[600] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {remaining.length}
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Nobody clocked these out. They keep counting until someone does, and
          the hours they report are the hours payroll pays.
        </p>
      </div>

      {remaining.length === 0 ? (
        <p className="px-4 py-4 text-xs text-green-600">
          All caught up. Every clock on this list is closed.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {remaining.map((r) => (
            <Row
              key={r.sessionId}
              row={r}
              onDone={(id, msg) => setClosed((c) => ({ ...c, [id]: msg }))}
            />
          ))}
        </ul>
      )}

      {Object.entries(closed).length > 0 && (
        <p role="status" className="px-4 pb-3 pt-2 text-xs text-green-600">
          {Object.values(closed)[Object.values(closed).length - 1]}
        </p>
      )}
    </section>
  );
}
