"use client";

// The cleaners × Mon–Sun availability table — ONE implementation, three
// surfaces (Stage 12.2, PDF #12 p.8).
//
// It was born inside `admin/employees/AvailabilityOverview.tsx` as a collapsed
// card. Stage 12 needed the same table on a page of its own, and the brief is
// explicit about extracting rather than duplicating: two grids reading the same
// two tables would drift the first time one of them learned about a rule the
// other didn't. `AvailabilityOverview` is now the collapsible wrapper around
// this component; /admin/availability renders it directly, dated.
//
// TWO MODES, one table:
//   • GENERIC (no `week`) — the columns are weekdays and a trailing "Time off"
//     column lists upcoming blocked dates. What the Field Lead's My Team tab
//     shows, and what the Employees page showed before Stage 12 retired it.
//   • DATED (`week` given) — the columns are the seven real dates of one week,
//     so a blocked date lands on the cell it actually blocks and is struck
//     through there. A date column can say "this Tuesday is off" in a way a
//     weekday column never could.

import Link from "next/link";

/** One weekday rule as the grid renders it. */
export interface AvailabilityGridSlot {
  /** MONDAY…SUNDAY */
  day: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

export interface AvailabilityGridRow {
  employeeId: string;
  employeeName: string;
  /** Slot per weekday; a missing day means no availability was set for it. */
  slots: AvailabilityGridSlot[];
  /** One-off blocked dates ("YYYY-MM-DD"). These override the weekly slots. */
  timeOff?: Array<{ date: string; reason: string | null }>;
  /**
   * Off-roster markers. BOTH OPTIONAL, and omitted by the two generic callers
   * (the Employees overview and My Team), which only ever pass live, active
   * cleaners — an absent field means "on the roster" and renders nothing.
   *
   * /admin/availability is the one surface that can opt these rows in, via its
   * "Include archived & deactivated" toggle. A row of hours with no marker
   * beside the name reads as bookable, which for somebody who has been archived
   * is exactly the wrong answer.
   */
  isActive?: boolean;
  isArchived?: boolean;
}

/** One dated column. `day` ties it to the weekday key the slots are stored on. */
export interface AvailabilityGridDay {
  /** "YYYY-MM-DD" */
  dateKey: string;
  /** MONDAY…SUNDAY — must match the slots' `day`. */
  day: string;
  /** Column header, e.g. "Mon 17". */
  label: string;
  isToday?: boolean;
  isSelected?: boolean;
}

export const AVAILABILITY_GRID_DAYS = [
  { key: "MONDAY", label: "Mon" },
  { key: "TUESDAY", label: "Tue" },
  { key: "WEDNESDAY", label: "Wed" },
  { key: "THURSDAY", label: "Thu" },
  { key: "FRIDAY", label: "Fri" },
  { key: "SATURDAY", label: "Sat" },
  { key: "SUNDAY", label: "Sun" },
] as const;

/** "2026-07-13" → "Jul 13" (plain calendar date — no timezone maths). */
export function shortDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function AvailabilityWeekGrid({
  rows,
  linkProfiles = true,
  week,
  showTimeOff,
  onSelectDay,
}: {
  rows: AvailabilityGridRow[];
  /**
   * PRIVACY prop, not a styling one: `/admin/employees/[id]` is OWNER/ADMIN-only,
   * so linking there from a Field Lead's view would advertise a page that
   * bounces them.
   */
  linkProfiles?: boolean;
  /** Seven dated columns, Mon…Sun. Omit for the generic weekday grid. */
  week?: AvailabilityGridDay[];
  /** Trailing "Time off" column. Defaults ON only when the columns are undated —
   *  a dated grid already strikes the blocked cell, so the column would repeat
   *  itself. */
  showTimeOff?: boolean;
  /** Dated grids only: clicking a column header drills into that day. */
  onSelectDay?: (dateKey: string) => void;
}) {
  const dated = !!week && week.length > 0;
  const columns: Array<{ key: string; label: string; date: AvailabilityGridDay | null }> =
    dated
      ? week!.map((w) => ({ key: w.day, label: w.label, date: w }))
      : AVAILABILITY_GRID_DAYS.map((d) => ({
          key: d.key,
          label: d.label,
          date: null,
        }));
  const withTimeOff = showTimeOff ?? !dated;

  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
            <th className="py-2 pr-4 font-[600]">Cleaner</th>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`py-2 pr-3 font-[600] ${
                  c.date?.isSelected ? "text-[#008C9C]" : ""
                }`}>
                {onSelectDay && c.date ? (
                  <button
                    type="button"
                    onClick={() => onSelectDay(c.date!.dateKey)}
                    title={`See ${c.label} in the day view`}
                    className="uppercase tracking-wide hover:text-[#008C9C]">
                    {c.label}
                    {c.date.isToday && <span aria-hidden> •</span>}
                  </button>
                ) : (
                  <>
                    {c.label}
                    {c.date?.isToday && <span aria-hidden> •</span>}
                  </>
                )}
              </th>
            ))}
            {withTimeOff && <th className="py-2 pr-3 font-[600]">Time off</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const byDay = new Map(row.slots.map((s) => [s.day, s]));
            const blockedByDate = new Map(
              (row.timeOff ?? []).map((t) => [t.date, t])
            );
            return (
              <tr key={row.employeeId} className="border-t border-gray-100">
                <td className="py-2 pr-4 whitespace-nowrap">
                  {linkProfiles ? (
                    <Link
                      href={`/admin/employees/${row.employeeId}?tab=availability`}
                      className="text-[#008C9C] hover:underline font-[500]">
                      {row.employeeName}
                    </Link>
                  ) : (
                    <span className="text-gray-800 font-[500]">
                      {row.employeeName}
                    </span>
                  )}
                  {row.isArchived ? (
                    <span
                      className="ml-1.5 text-[10px] uppercase tracking-wide text-red-600"
                      title="Archived — restorable from Employees → Archived. Cannot be booked.">
                      Archived
                    </span>
                  ) : row.isActive === false ? (
                    <span
                      className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-700"
                      title="Login deactivated. Cannot be booked.">
                      Deactivated
                    </span>
                  ) : null}
                </td>
                {columns.map((c) => {
                  const slot = byDay.get(c.key);
                  // A one-off block beats the weekly rule — the same precedence
                  // `evaluateAvailability` applies — so the cell has to say so or
                  // the table lies about who is free.
                  const blocked = c.date
                    ? blockedByDate.get(c.date.dateKey)
                    : undefined;
                  return (
                    <td
                      key={c.key}
                      // The CELL is struck, not just the hours inside it.
                      // `text-decoration-line` is not an inherited property, so
                      // whichever element carries it is the only one that
                      // reports it — and the strike used to sit on the hours
                      // substring alone. On a blocked day with no weekly rule
                      // that meant striking a bare em-dash, which is
                      // indistinguishable from an unstruck one, while the word
                      // "off" beside it stayed upright. The cell read as plain
                      // red text and the "struck through in the grid" the stage
                      // asks for was invisible exactly where it mattered most.
                      className={`py-2 pr-3 whitespace-nowrap text-xs ${
                        c.date?.isSelected ? "bg-[#008C9C]/[0.05]" : ""
                      } ${blocked ? "line-through" : ""}`}>
                      {blocked ? (
                        <span
                          className="text-red-500"
                          title={
                            blocked.reason
                              ? `Blocked — ${blocked.reason}`
                              : "Blocked date (time off)"
                          }>
                          {/* The label carries the decoration too, so the text
                              node itself is struck however the cell is styled. */}
                          <span className="line-through">
                            {slot && slot.isAvailable
                              ? `${slot.startTime}–${slot.endTime}`
                              : "—"}{" "}
                            off
                          </span>
                        </span>
                      ) : !slot ? (
                        <span className="text-gray-300">—</span>
                      ) : slot.isAvailable ? (
                        <span className="text-gray-600">
                          {slot.startTime}–{slot.endTime}
                        </span>
                      ) : (
                        <span className="text-red-400">Unavailable</span>
                      )}
                    </td>
                  );
                })}
                {withTimeOff && (
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">
                    {!row.timeOff || row.timeOff.length === 0 ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <span
                        className="text-red-500"
                        title={row.timeOff
                          .map(
                            (t) => `${t.date}${t.reason ? ` — ${t.reason}` : ""}`
                          )
                          .join("\n")}>
                        {row.timeOff
                          .slice(0, 2)
                          .map((t) => shortDateKey(t.date))
                          .join(", ")}
                        {row.timeOff.length > 2
                          ? ` +${row.timeOff.length - 2}`
                          : ""}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
