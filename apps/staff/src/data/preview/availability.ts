// Sample availability for development builds: a weekly pattern and a
// holiday, held in memory so saving hours and booking days off stick.
import type { AvailabilityResponse, DayOff, WeekDay } from "@bookmops/api/v1";
import { ApiError } from "@bookmops/api/client";
import { addDays, daysBetween } from "@bookmops/ui-native";

import type { DataSource } from "../source";
import { delay } from "./delay";
import { previewMe } from "./jobs";
import { once } from "./replay";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: previewMe().company.timezone }).format(new Date());

let week: WeekDay[] = [
  { day: "MONDAY", available: true, start: "08:00", end: "17:00" },
  { day: "TUESDAY", available: true, start: "08:00", end: "17:00" },
  { day: "WEDNESDAY", available: true, start: "12:00", end: "20:00" },
  { day: "THURSDAY", available: true, start: "08:00", end: "17:00" },
  { day: "FRIDAY", available: true, start: "08:00", end: "14:00" },
  { day: "SATURDAY", available: false, start: "09:00", end: "17:00" },
  { day: "SUNDAY", available: false, start: "09:00", end: "17:00" },
];

let nextId = 1;
function span(from: string, to: string, reason: string | null): DayOff[] {
  return Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => ({ id: `off-${nextId++}`, date: addDays(from, i), reason }));
}
let daysOff: DayOff[] = [...span(addDays(today(), 17), addDays(today(), 24), "Vacation"), ...span(addDays(today(), 6), addDays(today(), 6), "Appointment")];

function response(): AvailabilityResponse {
  return {
    week,
    isRecurring: true,
    effectiveFrom: null,
    effectiveTo: null,
    daysOff: [...daysOff].filter((d) => daysBetween(d.date, today()) <= 60).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function checkSpan(from: string, to: string) {
  const n = daysBetween(from, to);
  if (n < 0) throw new ApiError("The last day off can't be before the first.", 400, "VALIDATION", false);
  if (n > 30) throw new ApiError("Book up to 31 days at a time.", 400, "VALIDATION", false);
}

export const previewAvailabilityApi = {
  availability: () => delay(response()),
  setWeek: (body) =>
    once(body.clientEventId, () => {
      for (const d of body.days) {
        if (d.available && d.start >= d.end) throw new ApiError("End time must be after start time.", 400, "VALIDATION", false);
      }
      week = body.days.map((d) => ({ ...d }));
      return response();
    }),
  addDaysOff: (body) =>
    once(body.clientEventId, () => {
      checkSpan(body.from, body.to);
      const reason = body.reason?.trim() || null;
      const kept = daysOff.filter((d) => d.date < body.from || d.date > body.to);
      daysOff = [...kept, ...span(body.from, body.to, reason)];
      return response();
    }),
  // Deleting is idempotent by nature, so each call just runs.
  removeDaysOff: (from, to) =>
    once(`remove-${from}-${to}-${Date.now()}`, () => {
      checkSpan(from, to);
      daysOff = daysOff.filter((d) => d.date < from || d.date > to);
      return response();
    }),
} satisfies Pick<DataSource, "availability" | "setWeek" | "addDaysOff" | "removeDaysOff">;
