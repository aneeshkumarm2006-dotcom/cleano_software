"use client";

import React, { useEffect, useState } from "react";
import { OfficeHours } from "./calendar-helpers";
import { getAvailability } from "@/app/(app)/actions/getAvailability";
import type { AvailabilitySlotDTO } from "@/app/(app)/actions/getAvailability.types";

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

let cachedSlotsPromise: Promise<AvailabilitySlotDTO[] | null> | null = null;

function loadSlots(): Promise<AvailabilitySlotDTO[] | null> {
  if (!cachedSlotsPromise) {
    cachedSlotsPromise = getAvailability().then((res) =>
      res.success ? res.slots : null
    );
  }
  return cachedSlotsPromise;
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
 * Shades unavailable time bands for the current user on a single day column.
 * Applies to the user's own self-view — fetches the logged-in user's availability.
 */
export const AvailabilityOverlay: React.FC<AvailabilityOverlayProps> = ({
  day,
  officeHours,
  zoomLevel,
}) => {
  const [slots, setSlots] = useState<AvailabilitySlotDTO[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSlots().then((s) => {
      if (!cancelled) setSlots(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!slots || slots.length === 0) return null;

  const visibleStartMin = (officeHours?.start ?? 0) * 60;
  const visibleEndMin = (officeHours?.end ?? 24) * 60;
  const officeStart = officeHours?.start ?? 0;

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
