"use server";

import { db } from "@/db";
import { computeBadgeMaps, type MissingItem } from "./_calendarBadges";
import { CALENDAR_JOB_SELECT, type CalendarJobRow } from "./_calendarSelect";
import {
  calendarScopeFilter,
  projectCalendarMetadata,
  resolveCalendarViewer,
  type CalendarViewer,
} from "./_calendarScope";
import type { PriorityLabel } from "@/lib/calendar-labels";
import { activeSubtotal } from "@/lib/job-money";
import { storeCivilDayRange, storeDateKey, storeParts } from "@/lib/timezone";

// Clamp a civil date ("2026-08-12") to its store-timezone day bounds. Half-open
// [start, end): `new Date(dateStr)` + setHours() gave the HOST's midnight (UTC
// on Vercel), so the day column was offset by 4-5 hours (Q9).
function getDayBounds(dateStr: string) {
  if (Number.isNaN(new Date(dateStr).getTime())) {
    throw new Error("Invalid date");
  }
  return storeCivilDayRange(dateStr);
}

// The shared calendar components position events with browser-local
// getHours()/getDate() and render labels in browser-local time. To make them
// show the STORE timezone for every viewer regardless of their own tz, we hand
// them a "floating" datetime string (no Z) whose components are the store
// wall-clock of the true instant. Parsed as local, getHours() then yields the
// store hour and a plain local label shows store time — consistent for all
// viewers. This is why calendar-helpers/EventCard/MonthView deliberately do
// NOT re-format through the store timezone: that would convert twice.
function toBusinessWallClock(date: Date): string {
  const p = storeParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(
    p.minute
  )}:${pad(p.second)}.000`;
}

/**
 * A row → the exact event object the calendar components consume.
 *
 * Extracted verbatim from `getJobsForDay` so the per-day route and the range
 * route cannot drift: the range endpoint exists purely to collapse 31 HTTP
 * round trips into one, and the payload it emits has to stay byte-identical to
 * what the fan-out produced.
 *
 * Stage 7: `viewer` is REQUIRED, not optional. The metadata block below carries
 * `price`, `employeePay`, `totalTip`, `parking` and payment state, and
 * FIELD_LEAD now sees their whole group's jobs here — so there must be no way to
 * build an event without deciding whether this viewer may read money. A
 * defaulted parameter would have made the leak the quiet path.
 */
function toCalendarEvent(
  job: CalendarJobRow,
  priorityMap: Record<string, PriorityLabel>,
  missingEquipmentMap: Record<string, MissingItem[]>,
  viewer: Pick<CalendarViewer, "canSeeMoney">
) {
  const startTime = new Date(job.startTime);
  const endTime = job.endTime ? new Date(job.endTime) : undefined;
  const cleanerNames = job.cleaners.map((c) => c.name).join(", ");
  const label = cleanerNames || (job.employee?.name ?? "Unassigned");

  return {
    id: job.id,
    title: job.clientName,
    description: job.description || undefined,
    label,
    // Floating Toronto wall-clock so the calendar grid + labels show business
    // time for every viewer (see toBusinessWallClock).
    start: toBusinessWallClock(startTime),
    end: endTime ? toBusinessWallClock(endTime) : undefined,
    confirmed: job.status !== "CREATED" && job.status !== "CANCELLED",
    importance:
      job.status === "IN_PROGRESS" ? 5 : job.status === "SCHEDULED" ? 3 : 1,
    // Everything money-bearing in here is nulled and `notes` sanitized for
    // viewers who aren't OWNER/ADMIN — see projectCalendarMetadata.
    metadata: projectCalendarMetadata({
      jobId: job.id,
      jobType: job.jobType,
      location: job.location,
      // Unit number on calendar cards + the job popover (item 2). `location`
      // stays the bare street: shortLocation() comma-splits it for the card
      // label, and folding the unit in would break that.
      aptNumber: job.aptNumber,
      status: job.status,
      // The card's price label — the ACTIVE value of the job (fix 3). Kept
      // byte-identical to getJobsForCalendar's line so the live feed and the
      // prefetched one can never quote different numbers for the same day.
      price: activeSubtotal(job),
      // Stage 8 — byte-identical to getJobsForCalendar's block, same reason as
      // the `price` line above. `billedHourlyRate` is money and is redacted by
      // projectCalendarMetadata; the type and the hours are not.
      billingType: job.billingType,
      billedHourlyRate: job.billedHourlyRate,
      billedHours: job.billedActualHours ?? job.billedEstimatedHours,
      // Stage 9 — the card's "Apt"/"House" tag. Property information, no money
      // in it, so every calendar audience sees it (see _calendarScope.ts).
      propertyType: job.propertyType,
      employeePay: job.employeePay,
      totalTip: job.totalTip,
      parking: job.parking,
      paymentReceived: job.paymentReceived,
      invoiceSent: job.invoiceSent,
      notes: job.notes,
      employeeId: job.employee?.id ?? "",
      employeeName: job.employee?.name ?? "Unassigned",
      cleaners: job.cleaners,
      missingEquipment: missingEquipmentMap[job.id] || [],
      priorityLabel: priorityMap[job.id] ?? "NONE",
      rescheduleRequestedAt: job.rescheduleRequestedAt
        ? job.rescheduleRequestedAt.toISOString()
        : null,
    }, viewer),
  };
}

type CalendarEventPayload = ReturnType<typeof toCalendarEvent>;

/** Longest span the range endpoint will serve. The calendar never asks for more
 *  than a month; the cap is here so a hand-crafted query string can't turn one
 *  request into an unbounded scan. */
const MAX_RANGE_DAYS = 62;

/**
 * The viewer scope both feeds apply:
 *   OWNER/ADMIN → every job, money visible;
 *   FIELD_LEAD  → their group's jobs, money redacted (Stage 7 / PDF #7);
 *   everyone else → their own jobs, money redacted.
 *
 * Resolution lives in `./_calendarScope.ts` so the scope and the redaction are
 * decided by the same object and cannot be applied one without the other.
 */
function calendarWhere(start: Date, end: Date, viewer: CalendarViewer) {
  const where: any = {
    deletedAt: null,
    OR: [
      // jobDate within the span (end is exclusive — see getDayBounds)
      { jobDate: { gte: start, lt: end } },
      // startTime within the span
      { startTime: { gte: start, lt: end } },
    ],
  };

  const scoped = calendarScopeFilter(viewer);
  if (scoped) where.AND = [scoped];

  return where;
}

export async function getJobsForDay(dateStr: string) {
  const viewer = await resolveCalendarViewer();

  const { start, end } = getDayBounds(dateStr);

  const jobs = await db.job.findMany({
    where: calendarWhere(start, end, viewer),
    // Explicit select, not `include` (Stage 5 item 5). `include` with no select
    // pulls every one of Job's ~90 columns, of which the mapper uses 19. The
    // drawer fetches the rest on open (getJobSummary), so the grid payload has
    // no reason to carry taxes, Stripe ids or wash projections.
    select: CALENDAR_JOB_SELECT,
    // `id` last as a TIEBREAK. Without it two jobs sharing a jobDate and
    // startTime came back in whatever order the scan produced, which differs
    // between a one-day query and a one-month query (measured: 14 of 31 days
    // in August disagreed on ordering while holding identical id sets). The
    // range route has to be able to reproduce the per-day payload exactly.
    orderBy: [{ jobDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });

  // Resolve priority labels (R/I) + missing-equipment warnings. Admins and field
  // leads see the warning for every assigned cleaner on the jobs they can
  // already see; a cleaner sees it for their own kit.
  const { priority: priorityMap, missing: missingEquipmentMap } =
    await computeBadgeMaps(jobs, {
      allAssignedCleaners: viewer.allAssignedCleaners,
      viewerId: viewer.viewerId,
    });

  return jobs.map((job) =>
    toCalendarEvent(job, priorityMap, missingEquipmentMap, viewer)
  );
}

/**
 * Every calendar event in `[startStr, endStr]` (inclusive civil days), grouped
 * by store-timezone day.
 *
 * This is `getJobsForDay` run once for a whole span instead of once per day.
 * The month view used to issue 31 separate `/api/calendar/<date>` requests
 * against a 6-connection-per-origin browser cap, and each one paid for its own
 * `auth.api.getSession()`, its own job query and its own `computeBadgeMaps`
 * pass — so a month could sit empty for a minute or more. One session check,
 * one query, one badge pass.
 *
 * The bucketing deliberately reproduces the fan-out's semantics exactly,
 * including the case where a job's `jobDate` and `startTime` land on different
 * civil days: the per-day route returned that job for BOTH days, so this does
 * too. The `select` is the same shared `CALENDAR_JOB_SELECT`, so the month
 * payload stays as light per row as it was before.
 */
export async function getJobsForRange(startStr: string, endStr: string) {
  const viewer = await resolveCalendarViewer();

  const { start } = getDayBounds(startStr);
  const { end } = getDayBounds(endStr);

  if (end <= start) {
    throw new Error("Invalid range");
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 25 * 3600_000) {
    throw new Error("Range too large");
  }

  const jobs = await db.job.findMany({
    where: calendarWhere(start, end, viewer),
    select: CALENDAR_JOB_SELECT,
    // `id` last as a TIEBREAK. Without it two jobs sharing a jobDate and
    // startTime came back in whatever order the scan produced, which differs
    // between a one-day query and a one-month query (measured: 14 of 31 days
    // in August disagreed on ordering while holding identical id sets). The
    // range route has to be able to reproduce the per-day payload exactly.
    orderBy: [{ jobDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });

  const { priority: priorityMap, missing: missingEquipmentMap } =
    await computeBadgeMaps(jobs, {
      allAssignedCleaners: viewer.allAssignedCleaners,
      viewerId: viewer.viewerId,
    });

  // Pre-seed every civil day in the span so a day with no jobs comes back as an
  // explicit empty array rather than a missing key.
  const days: Record<string, CalendarEventPayload[]> = {};
  const cursor = new Date(`${startStr}T00:00:00Z`);
  const lastKey = endStr;
  for (;;) {
    const key = `${cursor.getUTCFullYear()}-${String(
      cursor.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    days[key] = [];
    if (key >= lastKey) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const job of jobs) {
    const event = toCalendarEvent(job, priorityMap, missingEquipmentMap, viewer);
    // A Set, because the two clauses of `calendarWhere` frequently point at the
    // same day and the per-day route returned one row, not two.
    const keys = new Set<string>();
    if (job.jobDate) keys.add(storeDateKey(job.jobDate));
    if (job.startTime) keys.add(storeDateKey(job.startTime));
    for (const key of keys) {
      if (days[key]) days[key].push(event);
    }
  }

  return days;
}

