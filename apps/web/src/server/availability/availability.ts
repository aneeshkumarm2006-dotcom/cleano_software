// Availability: the weekly pattern a person works to, and the days off laid
// over it (availability.ts in @bookmops/api). A day off always wins.
//
// The v1 routes act on the CALLER's own availability only; the employee id is
// the actor's, never the request's. The web's actions, which also let an
// owner or admin edit anyone's, authorize first and then call the writers
// here with the employee they resolved (setAvailability,
// addAvailabilityException).
import "server-only";

import type { AvailabilityDay } from "@prisma/client";
import type { AvailabilityResponse } from "@bookmops/api/v1";

import { addDateKeyDays, dateKeyFromStoredDate, dateKeyToStoredDate } from "@/lib/availability";
import { db } from "@/lib/org-db";
import { storeDateKey } from "@/lib/timezone";

import type { Actor } from "../actor";
import { failure, ok, type Result } from "../result";

export const WEEK: AvailabilityDay[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** How far back days off are returned: older ones are history. */
const DAYS_OFF_LOOKBACK = 60;
const DAYS_OFF_LIMIT = 400;
/** The web's window for a day off (availabilityExceptions.ts). */
export const MAX_PAST_DAYS = 365;
export const MAX_FUTURE_DAYS = 730;
/** The longest stretch in one request (MAX_DAYS_OFF_SPAN in the contract). */
export const MAX_SPAN_DAYS = 31;
const MAX_REASON = 200;

// ── Reading ─────────────────────────────────────────────────────────────────

/** The caller's week (all seven days, Monday first) and days off from 60 days back. */
export async function getMyAvailability(actor: Actor, now: Date): Promise<Result<AvailabilityResponse>> {
  const since = new Date(now.getTime() - DAYS_OFF_LOOKBACK * 86_400_000);
  const [slots, daysOff] = await Promise.all([
    db.employeeAvailability.findMany({ where: { employeeId: actor.userId } }),
    db.availabilityException.findMany({
      where: { employeeId: actor.userId, date: { gte: since } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: DAYS_OFF_LIMIT,
      select: { id: true, date: true, reason: true },
    }),
  ]);
  const byDay = new Map(slots.map((s) => [s.day, s]));
  const any = slots[0];
  return ok({
    week: WEEK.map((day) => {
      const s = byDay.get(day);
      // A day with no row: off, 09:00 to 17:00, as the web shows it.
      return s
        ? { day, available: s.isAvailable, start: s.startTime, end: s.endTime }
        : { day, available: false, start: "09:00", end: "17:00" };
    }),
    isRecurring: any ? any.isRecurring : true,
    effectiveFrom: any?.effectiveFrom ? dateKeyFromStoredDate(any.effectiveFrom) : null,
    effectiveTo: any?.effectiveTo ? dateKeyFromStoredDate(any.effectiveTo) : null,
    daysOff: daysOff.map((d) => ({ id: d.id, date: dateKeyFromStoredDate(d.date), reason: d.reason })),
  });
}

// ── The weekly pattern ──────────────────────────────────────────────────────

export interface WeekSlot {
  day: AvailabilityDay;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  isRecurring: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}

/** Replace an employee's weekly rows in one transaction. The caller has authorized. */
export async function replaceWeek(employeeId: string, slots: WeekSlot[]): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.employeeAvailability.deleteMany({ where: { employeeId } });
    if (slots.length > 0) {
      await tx.employeeAvailability.createMany({ data: slots.map((s) => ({ employeeId, ...s })) });
    }
  });
}

/**
 * PUT /availability/week: all seven days exactly once; on an available day
 * the start is before the end. isRecurring and the effective dates are KEPT
 * from what is on record, so saving hours from the phone never clears a limit
 * set on the web.
 */
export async function setMyWeek(
  actor: Actor,
  days: { day: AvailabilityDay; available: boolean; start: string; end: string }[],
  now: Date,
): Promise<Result<AvailabilityResponse>> {
  if (days.length !== 7 || new Set(days.map((d) => d.day)).size !== 7 || days.some((d) => !WEEK.includes(d.day))) {
    return failure(400, "VALIDATION_FAILED", "Send each day of the week exactly once.");
  }
  for (const d of days) {
    if (!TIME_RE.test(d.start) || !TIME_RE.test(d.end)) {
      return failure(400, "VALIDATION_FAILED", "Time must be HH:MM (24-hour)");
    }
    if (d.available && d.start >= d.end) {
      return failure(400, "VALIDATION_FAILED", `End time must be after start time (${d.day})`);
    }
  }

  const existing = await db.employeeAvailability.findMany({
    where: { employeeId: actor.userId },
    select: { day: true, isRecurring: true, effectiveFrom: true, effectiveTo: true },
  });
  const byDay = new Map(existing.map((e) => [e.day, e]));
  const fallback = existing[0];
  await replaceWeek(
    actor.userId,
    days.map((d) => {
      const kept = byDay.get(d.day) ?? fallback;
      return {
        day: d.day,
        startTime: d.start,
        endTime: d.end,
        isAvailable: d.available,
        isRecurring: kept ? kept.isRecurring : true,
        effectiveFrom: kept?.effectiveFrom ?? null,
        effectiveTo: kept?.effectiveTo ?? null,
      };
    }),
  );
  return getMyAvailability(actor, now);
}

// ── Days off ────────────────────────────────────────────────────────────────

type RangeCheck = { ok: true; keys: string[] } | { ok: false; message: string };

/** Every date key from `from` to `to` inclusive, within the span limit. */
export function dateRange(from: string, to: string): RangeCheck {
  const start = dateKeyToStoredDate(from);
  const end = dateKeyToStoredDate(to);
  if (!start || !end) return { ok: false, message: "Pick a valid date" };
  if (end.getTime() < start.getTime()) return { ok: false, message: "The last day off can't be before the first." };
  const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (span > MAX_SPAN_DAYS) return { ok: false, message: `Take at most ${MAX_SPAN_DAYS} days off at a time.` };
  const keys: string[] = [];
  for (let k: string | null = from; k && k <= to; k = addDateKeyDays(k, 1)) keys.push(k);
  return { ok: true, keys };
}

/**
 * The web's window, measured from today in the company's zone: not more than
 * a year back or two years ahead.
 */
export function withinWindow(dateKey: string, now: Date): string | null {
  const today = storeDateKey(now);
  const earliest = addDateKeyDays(today, -MAX_PAST_DAYS)!;
  const latest = addDateKeyDays(today, MAX_FUTURE_DAYS)!;
  if (dateKey < earliest) return "That date is too far in the past";
  if (dateKey > latest) return "That date is too far in the future";
  return null;
}

/**
 * Block dates for an employee. Idempotent: a date already off just gets the
 * new reason (one row per employee and date). The caller has authorized.
 */
export async function blockDates(
  employeeId: string,
  keys: string[],
  reason: string | null,
): Promise<{ id: string; date: string; reason: string | null }[]> {
  return db.$transaction(async (tx) => {
    const out: { id: string; date: string; reason: string | null }[] = [];
    for (const key of keys) {
      const date = dateKeyToStoredDate(key)!;
      const row = await tx.availabilityException.upsert({
        where: { employeeId_date: { employeeId, date } },
        update: { reason },
        create: { employeeId, date, reason },
        select: { id: true, reason: true },
      });
      out.push({ id: row.id, date: key, reason: row.reason });
    }
    return out;
  });
}

function cleanReason(raw: string | null | undefined): { ok: true; reason: string | null } | { ok: false; message: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length > MAX_REASON) return { ok: false, message: `Reason must be ${MAX_REASON} characters or fewer` };
  return { ok: true, reason: text || null };
}

/** POST /availability/days-off: the caller's own dates, `from` to `to`. */
export async function addMyDaysOff(
  actor: Actor,
  input: { from: string; to: string; reason?: string | null },
  now: Date,
): Promise<Result<AvailabilityResponse>> {
  const range = dateRange(input.from, input.to);
  if (!range.ok) return failure(400, "VALIDATION_FAILED", range.message);
  for (const key of [range.keys[0], range.keys[range.keys.length - 1]]) {
    const outside = withinWindow(key, now);
    if (outside) return failure(400, "VALIDATION_FAILED", outside);
  }
  const reason = cleanReason(input.reason);
  if (!reason.ok) return failure(400, "VALIDATION_FAILED", reason.message);
  await blockDates(actor.userId, range.keys, reason.reason);
  return getMyAvailability(actor, now);
}

/**
 * DELETE /availability/days-off?from&to: the caller's own rows in the range,
 * and nobody else's. A range with none is not an error.
 */
export async function removeMyDaysOff(
  actor: Actor,
  input: { from: string; to: string },
  now: Date,
): Promise<Result<AvailabilityResponse>> {
  const range = dateRange(input.from, input.to);
  if (!range.ok) return failure(400, "VALIDATION_FAILED", range.message);
  await db.availabilityException.deleteMany({
    where: {
      employeeId: actor.userId,
      date: { gte: dateKeyToStoredDate(input.from)!, lte: dateKeyToStoredDate(input.to)! },
    },
  });
  return getMyAvailability(actor, now);
}
