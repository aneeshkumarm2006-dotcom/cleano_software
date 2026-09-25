// Availability: the weekly pattern a cleaner works to, and the days off laid
// over it. A day off always wins over the weekly pattern; the office is only
// offered the cleaner inside the hours set here.
//
// Every route acts on the CALLER'S OWN availability. No request carries an
// employee id, so there is no id to swap: the server resolves the employee
// from the session, full stop. (On the web an owner or admin can edit anyone's
// availability; that is an admin surface and has no v1 route.)
import { z } from "zod";

import { LocalDate, openEnum } from "./common";

export const AVAILABILITY_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type AvailabilityDay = (typeof AVAILABILITY_DAYS)[number];

/** "08:00", "17:30": 24-hour, as the web stores it. */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time, like 08:00");

/** One weekday of the pattern. */
export const WeekDay = z.object({
  day: openEnum(AVAILABILITY_DAYS),
  available: z.boolean(),
  /** Kept even on a day off, so switching the day back on restores the hours. */
  start: ClockTime,
  end: ClockTime,
});
export type WeekDay = z.infer<typeof WeekDay>;

/** One date off. */
export const DayOff = z.object({
  id: z.string(),
  date: LocalDate,
  /** "Vacation", "Appointment"; null means unavailable all day, no reason given. */
  reason: z.string().nullable(),
});
export type DayOff = z.infer<typeof DayOff>;

/**
 * GET /api/v1/availability — the caller's weekly pattern and days off.
 *
 * Server: staff only; the session user's rows only. `week` always has all
 * seven days, Monday first: a day with no row on record comes back
 * `available: false, start "09:00", end "17:00"`, as the web shows it.
 * `daysOff` are from 60 days ago onward, oldest first (as `getAvailability`).
 */
export const AvailabilityResponse = z.object({
  week: z.array(WeekDay),
  /** Whether the pattern repeats every week (the web's "Recurring weekly"). */
  isRecurring: z.boolean(),
  /** When the pattern applies from and to, if the office or the web set limits. */
  effectiveFrom: LocalDate.nullable(),
  effectiveTo: LocalDate.nullable(),
  daysOff: z.array(DayOff),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponse>;

/**
 * PUT /api/v1/availability/week — replace the caller's weekly pattern.
 * Idempotent: the same body twice leaves the same pattern.
 *
 * Server: all seven days exactly once (400 otherwise); on an available day
 * `start` must be before `end`. Replaces the session user's rows in one
 * transaction, as `setAvailability` does. `isRecurring`, `effectiveFrom` and
 * `effectiveTo` are not sent by the app: the server KEEPS the values already
 * on record, so saving hours from the phone never clears a limit set on the
 * web. Returns the whole availability, as GET.
 */
export const WeekUpdateRequest = z.object({
  clientEventId: z.uuid(),
  days: z
    .array(
      z.object({
        day: z.enum(AVAILABILITY_DAYS),
        available: z.boolean(),
        start: ClockTime,
        end: ClockTime,
      }),
    )
    .length(7),
});
export type WeekUpdateRequest = z.infer<typeof WeekUpdateRequest>;

/** The longest stretch booked off in one go. Longer leave is two requests. */
export const MAX_DAYS_OFF_SPAN = 31;

/**
 * POST /api/v1/availability/days-off — take `from` to `to` (inclusive) off.
 * Idempotent: a date already off just gets the new reason (one row per
 * employee and date, as `addAvailabilityException`).
 *
 * Server: `to` on or after `from`, at most 31 days; dates in the company's
 * zone; the web's window applies (not more than a year back or two years
 * ahead). Returns the whole availability, as GET.
 */
export const DaysOffRequest = z.object({
  clientEventId: z.uuid(),
  from: LocalDate,
  to: LocalDate,
  reason: z.string().trim().max(200).nullable().optional(),
});
export type DaysOffRequest = z.infer<typeof DaysOffRequest>;

/*
 * DELETE /api/v1/availability/days-off?from=YYYY-MM-DD&to=YYYY-MM-DD — put the
 * caller back on their weekly pattern for those dates. Deletes only the
 * session user's rows in the range (a range with none is not an error, so a
 * retry is harmless). Same 31-day limit. Returns the whole availability.
 */
