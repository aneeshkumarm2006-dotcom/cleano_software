"use client";

import React, { useEffect, useState } from "react";
import { OfficeHours } from "./calendar-helpers";
import { getAvailability } from "@/app/admin/actions/getAvailability";
import type {
  AvailabilityExceptionDTO,
  AvailabilitySlotDTO,
} from "@/app/admin/actions/getAvailability.types";
import { useCalendarOverlays } from "./CalendarOverlaysContext";

interface AvailabilityOverlayProps {
  day: Date;
  officeHours: OfficeHours | null;
  zoomLevel: number;
}

const DAY_BY_INDEX = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

interface AvailabilityData {
  slots: AvailabilitySlotDTO[];
  exceptions: AvailabilityExceptionDTO[];
}

// Cache per viewed employee ("self" = the logged-in user) so the week view's
// seven day columns share one fetch.
const cachedSlotsPromises = new Map<
  string,
  Promise<AvailabilityData | null>
>();

function loadSlots(
  employeeId: string | null
): Promise<AvailabilityData | null> {
  const key = employeeId ?? "self";
  let promise = cachedSlotsPromises.get(key);
  if (!promise) {
    promise = getAvailability(employeeId ?? undefined).then((res) =>
      res.success
        ? { slots: res.slots, exceptions: res.exceptions }
        : null
    );
    cachedSlotsPromises.set(key, promise);
  }
  return promise;
}

/** Local calendar date of the rendered column as a plain "YYYY-MM-DD" key. */
function dayKey(day: Date): string {
  return [
    day.getFullYear(),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  ].join("-");
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((p) => parseInt(p, 10));
  return h * 60 + m;
}

interface UnavailableBand {
  startMin: number;
  endMin: number;
  reason: "no-slot" | "marked-unavailable";
}

function computeUnavailableBands(
  slots: AvailabilitySlotDTO[],
  day: Date,
  visibleStartMin: number,
  visibleEndMin: number
): UnavailableBand[] {
  const dayKey = DAY_BY_INDEX[day.getDay()];
  const dailySlots = slots.filter((s) => {
    if (s.day !== dayKey) return false;
    if (s.effectiveFrom && day < new Date(s.effectiveFrom)) return false;
    if (s.effectiveTo && day > new Date(s.effectiveTo)) return false;
    return true;
  });

  if (dailySlots.length === 0) {
    return [
      { startMin: visibleStartMin, endMin: visibleEndMin, reason: "no-slot" },
    ];
  }

  const availableRanges: Array<[number, number]> = dailySlots
    .filter((s) => s.isAvailable)
    .map((s) => [toMinutes(s.startTime), toMinutes(s.endTime)] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const range of availableRanges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }

  const bands: UnavailableBand[] = [];
  let cursor = visibleStartMin;
  for (const [s, e] of merged) {
    if (s > cursor) {
      bands.push({
        startMin: cursor,
        endMin: Math.min(s, visibleEndMin),
        reason: "no-slot",
      });
    }
    cursor = Math.max(cursor, e);
    if (cursor >= visibleEndMin) break;
  }
  if (cursor < visibleEndMin) {
    bands.push({
      startMin: cursor,
      endMin: visibleEndMin,
      reason: "no-slot",
    });
  }

  for (const slot of dailySlots) {
    if (slot.isAvailable) continue;
    const sMin = toMinutes(slot.startTime);
    const eMin = toMinutes(slot.endTime);
    if (eMin <= visibleStartMin || sMin >= visibleEndMin) continue;
    bands.push({
      startMin: Math.max(sMin, visibleStartMin),
      endMin: Math.min(eMin, visibleEndMin),
      reason: "marked-unavailable",
    });
  }

  return bands;
}

/**
 * Shades unavailable time bands on a single day column. By default this is
 * the logged-in user's own availability; admins can pick a specific cleaner
 * via the overlay toolbar, which flows in through the overlays context.
 */
export const AvailabilityOverlay: React.FC<AvailabilityOverlayProps> = ({
  day,
  officeHours,
  zoomLevel,
}) => {
  const { availabilityEmployeeId } = useCalendarOverlays();
  const [data, setData] = useState<AvailabilityData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    loadSlots(availabilityEmployeeId).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [availabilityEmployeeId]);

  if (!data) return null;
  const { slots, exceptions } = data;

  const visibleStartMin = (officeHours?.start ?? 0) * 60;
  const visibleEndMin = (officeHours?.end ?? 24) * 60;
  const officeStart = officeHours?.start ?? 0;

  // A one-off blocked date (vacation / appointment / sick day) wins over the
  // weekly rule — shade the whole column so a conflict is obvious on the
  // calendar before anything gets scheduled on it.
  const blocked = exceptions.find((e) => e.date === dayKey(day));
  if (blocked) {
    const top = 0;
    const height = ((visibleEndMin - visibleStartMin) * zoomLevel) / 60;
    if (height <= 0) return null;
    return (
      <div
        className="cal-unavail"
        style={{ top: `${top}px`, height: `${height}px`, zIndex: 5, opacity: 1 }}
        title={
          blocked.reason
            ? `Time off — ${blocked.reason}`
            : "Time off — blocked date"
        }
      />
    );
  }

  if (slots.length === 0) return null;

  const bands = computeUnavailableBands(slots, day, visibleStartMin, visibleEndMin);

  return (
    <>
      {bands.map((band, idx) => {
        const top = ((band.startMin - officeStart * 60) * zoomLevel) / 60;
        const height = ((band.endMin - band.startMin) * zoomLevel) / 60;
        if (height <= 0) return null;
        const isHard = band.reason === "marked-unavailable";
        return (
          <div
            key={`${day.toISOString()}-band-${idx}`}
            className="cal-unavail"
            style={{
              top: `${top}px`,
              height: `${height}px`,
              zIndex: 5,
              opacity: isHard ? 1 : 0.6,
            }}
            title={isHard ? "Unavailable" : "Outside availability hours"}
          />
        );
      })}
    </>
  );
};

export default AvailabilityOverlay;
