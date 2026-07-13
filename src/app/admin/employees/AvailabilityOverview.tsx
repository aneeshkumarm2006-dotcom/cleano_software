"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, ChevronDown, ChevronUp } from "lucide-react";
import Card from "@/components/ui/Card";

export interface AvailabilityOverviewRow {
  employeeId: string;
  employeeName: string;
  /** Slot per weekday (MONDAY…SUNDAY); missing day = no availability set. */
  slots: Array<{
    day: string;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
  }>;
  /** Upcoming one-off blocked dates ("YYYY-MM-DD"), soonest first. These
   *  override the weekly slots for that specific day. */
  timeOff?: Array<{ date: string; reason: string | null }>;
}

const DAYS = [
  { key: "MONDAY", label: "Mon" },
  { key: "TUESDAY", label: "Tue" },
  { key: "WEDNESDAY", label: "Wed" },
  { key: "THURSDAY", label: "Thu" },
  { key: "FRIDAY", label: "Fri" },
  { key: "SATURDAY", label: "Sat" },
  { key: "SUNDAY", label: "Sun" },
] as const;

/** "2026-07-13" → "Jul 13" (plain calendar date — no timezone maths). */
function shortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Compact all-cleaners availability table (cleaners × Mon–Sun). Collapsed by
 * default so the employees list stays the page's focus.
 */
export default function AvailabilityOverview({
  rows,
}: {
  rows: AvailabilityOverviewRow[];
}) {
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  return (
    <Card variant="default" className="p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#008C9C]" />
          <span className="text-sm font-[600] text-gray-800">
            Availability overview
          </span>
          <span className="text-xs text-gray-400">
            {rows.length} cleaner{rows.length === 1 ? "" : "s"}
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                <th className="py-2 pr-4 font-[600]">Cleaner</th>
                {DAYS.map((d) => (
                  <th key={d.key} className="py-2 pr-3 font-[600]">
                    {d.label}
                  </th>
                ))}
                <th className="py-2 pr-3 font-[600]">Time off</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const byDay = new Map(row.slots.map((s) => [s.day, s]));
                return (
                  <tr key={row.employeeId} className="border-t border-gray-100">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <Link
                        href={`/admin/employees/${row.employeeId}?tab=availability`}
                        className="text-[#008C9C] hover:underline font-[500]">
                        {row.employeeName}
                      </Link>
                    </td>
                    {DAYS.map((d) => {
                      const slot = byDay.get(d.key);
                      return (
                        <td
                          key={d.key}
                          className="py-2 pr-3 whitespace-nowrap text-xs">
                          {!slot ? (
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
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">
                      {!row.timeOff || row.timeOff.length === 0 ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <span
                          className="text-red-500"
                          title={row.timeOff
                            .map(
                              (t) =>
                                `${t.date}${t.reason ? ` — ${t.reason}` : ""}`
                            )
                            .join("\n")}>
                          {row.timeOff.slice(0, 2).map((t) => shortDate(t.date)).join(", ")}
                          {row.timeOff.length > 2
                            ? ` +${row.timeOff.length - 2}`
                            : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
