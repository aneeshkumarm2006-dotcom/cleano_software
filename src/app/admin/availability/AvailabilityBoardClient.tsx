"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import DatePicker from "@/components/ui/DatePicker";
import TimePicker from "@/components/ui/TimePicker";
import AvailabilityWeekGrid from "@/components/admin/AvailabilityWeekGrid";
import { PERMISSION_CATEGORIES, categoryLabel } from "@/lib/service-permissions";
import {
  AVAILABILITY_RESULT_LABEL,
  AVAILABILITY_RESULT_TONE,
  AVAILABILITY_STATUS_FILTERS,
  AVAILABILITY_STATUS_FILTER_LABEL,
  NO_FIELD_LEAD,
  isAvailabilityFiltered,
  type AvailabilityStatusFilter,
  type AvailabilityViewMode,
} from "@/lib/availability-view";
import type {
  AvailabilityBoardDTO,
  AvailabilityBoardRowDTO,
} from "../actions/getAvailabilityBoard.types";

const TIER_LABEL: Record<string, string> = {
  TRAINEE: "Trainee",
  STANDARD: "Standard",
  FIELD_LEAD: "Field Lead",
};

/** How long typing pauses before the search re-queries. */
const SEARCH_DEBOUNCE_MS = 400;

function DayRow({ row }: { row: AvailabilityBoardRowDTO }) {
  const hours =
    row.day.windows.length > 0
      ? row.day.windows.map((w) => `${w.startTime}–${w.endTime}`).join(", ")
      : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 rounded-xl hover:bg-black/[0.02] border-t border-gray-100 first:border-t-0">
      <Link
        href={`/admin/employees/${row.employeeId}?tab=availability`}
        className="text-sm font-[500] text-[#008C9C] hover:underline min-w-[160px]">
        {row.employeeName}
      </Link>
      <Badge variant={AVAILABILITY_RESULT_TONE[row.day.result]} size="xs">
        {AVAILABILITY_RESULT_LABEL[row.day.result]}
      </Badge>
      <span className="text-xs text-gray-700 tabular-nums">
        {hours ?? <span className="text-gray-400">no hours set</span>}
      </span>
      {row.day.reason && (
        <span className="text-xs text-gray-500">{row.day.reason}</span>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {/* Two different off-roster states, named apart on purpose: "Archived"
            is soft-deleted and restorable, "Deactivated" is a switched-off
            login. Either way the row is only here because the toggle is on, and
            an "Available" verdict beside it must not read as bookable. */}
        {row.isArchived && (
          <Badge variant="error" size="xs">
            Archived
          </Badge>
        )}
        {!row.isActive && (
          <Badge variant="warning" size="xs">
            Deactivated
          </Badge>
        )}
        <Badge variant="default" size="xs">
          {TIER_LABEL[row.cleanerTier] ?? row.cleanerTier}
        </Badge>
        {row.fieldLeadName && (
          <span className="text-xs text-gray-500">
            Group: {row.fieldLeadName}
          </span>
        )}
        <span
          className="text-xs text-gray-500"
          title={
            row.allowedServiceCategories.length === 0
              ? "No restriction — approved for every service"
              : row.allowedServiceCategories.map(categoryLabel).join(", ")
          }>
          {row.allowedServiceCategories.length === 0
            ? "All services"
            : row.allowedServiceCategories.map(categoryLabel).join(", ")}
        </span>
      </span>
    </div>
  );
}

/**
 * The all-cleaner availability board (PDF #12).
 *
 * Every control here is a FILTER, never an edit. Availability is written on the
 * cleaner's own profile, which each row links to — see the read-only note at the
 * bottom of the page and decision D12 in `_ai_context/TODO.md`.
 *
 * Filter state lives in the URL rather than in React, so the server does the
 * narrowing (a 200-cleaner roster never reaches the browser), the view survives
 * a refresh, and the job form can deep-link straight into a pre-filtered day.
 */
export default function AvailabilityBoardClient({
  board,
}: {
  board: AvailabilityBoardDTO;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQs = searchParams.toString();

  const { query } = board;

  const apply = useMemo(
    () =>
      (patch: Record<string, string | null>) => {
        const next = new URLSearchParams(currentQs);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        const qs = next.toString();
        // Re-picking what is already on screen is not a navigation.
        if (qs === currentQs) return;
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      },
    [currentQs, pathname, router]
  );

  // Search is the one control that must not fire per keystroke — it is a
  // `contains` query against the whole roster. The box holds its own value and
  // pushes to the URL once typing pauses.
  const [search, setSearch] = useState(query.q);
  useEffect(() => setSearch(query.q), [query.q]);
  useEffect(() => {
    if (search === query.q) return;
    const timer = setTimeout(
      () => apply({ q: search.trim() || null }),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [search, query.q, apply]);

  const setView = (view: AvailabilityViewMode) =>
    apply({ view: view === "week" ? null : view });

  const filtered = isAvailabilityFiltered(query);
  const noRows = board.rows.length === 0;

  return (
    <div className="admin-font h-full overflow-hidden overflow-y-auto p-8 stack-24">
      <header className="stack-8">
        <p className="eyebrow">Staff</p>
        <h1 className="display">
          Cleaner <em>availability.</em>
        </h1>
        <p className="subtitle">
          Every cleaner&apos;s hours in one place — by week, or by the exact day
          and time you are trying to fill.
        </p>
      </header>

      {/* ── View toggle ───────────────────────────────────────────────────── */}
      <div className="atabs">
        <button
          type="button"
          className={`atab${query.view === "week" ? " active" : ""}`}
          aria-pressed={query.view === "week"}
          onClick={() => setView("week")}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <CalendarDays size={15} />
            Week grid
          </span>
        </button>
        <button
          type="button"
          className={`atab${query.view === "day" ? " active" : ""}`}
          aria-pressed={query.view === "day"}
          onClick={() => setView("day")}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <CalendarClock size={15} />
            Day view
          </span>
        </button>
      </div>

      {/* ── Filters (PDF #12's list) ──────────────────────────────────────── */}
      <div className="dcard" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-gray-700">
            <span className="font-[600]">Cleaner</span>
            <span className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or email"
                className="rounded-lg border border-gray-200 bg-white pl-8 pr-2 py-1.5 text-xs text-gray-800 w-[180px]"
              />
            </span>
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-700">
            <span className="font-[600]">Service category</span>
            <select
              value={query.category ?? ""}
              onChange={(e) => apply({ category: e.target.value || null })}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800">
              <option value="">Any category</option>
              {PERMISSION_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-700">
            <span className="font-[600]">Field Lead group</span>
            <select
              value={query.lead ?? ""}
              onChange={(e) => apply({ lead: e.target.value || null })}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800">
              <option value="">Any group</option>
              {board.fieldLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value={NO_FIELD_LEAD}>No group</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-700">
            <span className="font-[600]">Availability status</span>
            <select
              value={query.status}
              onChange={(e) =>
                apply({
                  status:
                    (e.target.value as AvailabilityStatusFilter) === "all"
                      ? null
                      : e.target.value,
                })
              }
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800">
              {AVAILABILITY_STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {AVAILABILITY_STATUS_FILTER_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-700">
            <span className="font-[600]">Date</span>
            <DatePicker
              size="sm"
              value={board.dateKey}
              onChange={(v) => apply({ date: v || null })}
            />
          </label>

          {/* "Off the roster" is two states — archived (soft-deleted) and
              deactivated (login switched off) — and the label used to name only
              the second, which is the rarer of the two. An admin looking at the
              seven names under Employees → Archived ticked this and saw nothing
              change. */}
          <label
            className="flex items-center gap-2 text-xs text-gray-700 pb-1.5"
            title="Cleaners who have been archived (soft-deleted) or had their login deactivated. Their stored hours are still on file; they cannot be booked.">
            <input
              type="checkbox"
              checked={query.includeInactive}
              onChange={(e) => apply({ inactive: e.target.checked ? "1" : null })}
            />
            Include archived &amp; deactivated
          </label>

          {filtered && (
            <button
              type="button"
              className="btn btn-ghost btn-sm ml-auto"
              onClick={() =>
                apply({
                  q: null,
                  category: null,
                  lead: null,
                  status: null,
                  inactive: null,
                  from: null,
                  to: null,
                })
              }>
              Clear filters
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-gray-600">
          Showing <strong>{board.rows.length}</strong> of{" "}
          {board.matchedCleaners} matching{" "}
          {board.matchedCleaners === 1 ? "cleaner" : "cleaners"} ·{" "}
          {board.totalCleaners} active in total ·{" "}
          <span className="text-green-700">
            {board.dayCounts.available} available
          </span>
          {" · "}
          <span className="text-red-600">
            {board.dayCounts.unavailable} not available
          </span>
          {board.dayCounts.unknown > 0 && (
            <>
              {" · "}
              {/* Neither bucket, on purpose — see AVAILABILITY_STATUS_FILTERS.
                  A cleaner who never filled the form in is unknown, not busy. */}
              <span className="text-gray-500">
                {board.dayCounts.unknown} with no availability on file
              </span>
            </>
          )}
          {" on "}
          {board.dateLabel}.
        </p>

        {/* The toggle has to be falsifiable. Before this, ticking it changed the
            URL and nothing else on screen — including this footer, whose
            "N active in total" is active-only by definition — so "there is
            nobody off the roster" and "the filter is not wired up" looked
            identical. They are the same three words apart. */}
        <p className="mt-1.5 text-xs text-gray-600">
          {board.offRosterCleaners === 0
            ? "No archived or deactivated cleaners on file — the toggle has nothing to add."
            : query.includeInactive
              ? `Including ${board.offRosterCleaners} archived or deactivated ${
                  board.offRosterCleaners === 1 ? "cleaner" : "cleaners"
                }. They keep their stored hours but cannot be booked.`
              : `${board.offRosterCleaners} archived or deactivated ${
                  board.offRosterCleaners === 1 ? "cleaner is" : "cleaners are"
                } hidden.`}
        </p>

        {board.truncated && (
          <p className="mt-1.5 text-xs text-amber-700">
            Only the first {board.rows.length} cleaners are shown. Narrow the
            search or pick a group to see the rest.
          </p>
        )}
      </div>

      {/* ── Week grid ─────────────────────────────────────────────────────── */}
      {query.view === "week" && (
        <div className="dcard" style={{ padding: 16 }}>
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Previous week"
              onClick={() => apply({ date: board.prevWeekDate })}>
              <ChevronLeft size={15} />
            </button>
            <h3 className="text-sm font-[600] text-gray-800">
              {board.weekLabel}
            </h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Next week"
              onClick={() => apply({ date: board.nextWeekDate })}>
              <ChevronRight size={15} />
            </button>
            {!board.isToday && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => apply({ date: null })}>
                This week
              </button>
            )}
            <span className="ml-auto text-xs text-gray-500">
              Click a day heading to open it in the day view.
            </span>
          </div>

          {noRows ? (
            <p className="px-1 py-3 text-sm text-gray-600">
              No cleaners match these filters.
            </p>
          ) : (
            <AvailabilityWeekGrid
              rows={board.rows}
              week={board.week}
              onSelectDay={(dateKey) => apply({ date: dateKey, view: "day" })}
            />
          )}
        </div>
      )}

      {/* ── Day view ──────────────────────────────────────────────────────── */}
      {query.view === "day" && (
        <div className="dcard" style={{ padding: 16 }}>
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Previous day"
              onClick={() => apply({ date: board.prevDayDate })}>
              <ChevronLeft size={15} />
            </button>
            <h3 className="text-sm font-[600] text-gray-800">
              {board.dateLabel}
            </h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Next day"
              onClick={() => apply({ date: board.nextDayDate })}>
              <ChevronRight size={15} />
            </button>
            {!board.isToday && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => apply({ date: null })}>
                Today
              </button>
            )}

            <span className="ml-auto flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-gray-700">
                <span className="font-[600]">From</span>
                <TimePicker
                  size="sm"
                  value={query.from ?? ""}
                  placeholder="Any time"
                  // Clearing the start clears the end too: an end without a
                  // start is not a window, and the parser drops it anyway.
                  onChange={(v) => apply(v ? { from: v } : { from: null, to: null })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-700">
                <span className="font-[600]">To</span>
                <TimePicker
                  size="sm"
                  value={query.to ?? ""}
                  placeholder="Any time"
                  disabled={!query.from}
                  onChange={(v) => apply({ to: v || null })}
                />
              </label>
            </span>
          </div>

          <p className="pb-2 text-xs text-gray-600">
            {query.from ? (
              <>
                Evaluated for <strong>{query.from}</strong>
                {query.to ? `–${query.to}` : ""} — the same check the job form
                runs when you assign a cleaner. Hours shown are that
                cleaner&apos;s full day.
              </>
            ) : (
              <>
                Evaluated for the whole day. Set a time to ask the narrower
                question — &ldquo;who can work 9–12?&rdquo;
              </>
            )}
          </p>

          {noRows ? (
            <p className="px-1 py-3 text-sm text-gray-600">
              No cleaners match these filters on {board.dateLabel}.
            </p>
          ) : (
            <div className="flex flex-col">
              {board.rows.map((row) => (
                <DayRow key={row.employeeId} row={row} />
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500">
        This view is read-only. Blocked dates (vacation, appointments, sick days)
        always beat the weekly hours — to change either, open a cleaner and use
        the Availability tab on their profile.
      </p>
    </div>
  );
}
