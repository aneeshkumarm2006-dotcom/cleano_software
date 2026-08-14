"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { computeBadgeMaps, type MissingItem } from "./_calendarBadges";
import { CALENDAR_JOB_SELECT, type CalendarJobRow } from "./_calendarSelect";
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
 */
function toCalendarEvent(
  job: CalendarJobRow,
  priorityMap: Record<string, PriorityLabel>,
  missingEquipmentMap: Record<string, MissingItem[]>
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
    metadata: {
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
    },
  };
}

type CalendarEventPayload = ReturnType<typeof toCalendarEvent>;

/** Longest span the range endpoint will serve. The calendar never asks for more
 *  than a month; the cap is here so a hand-crafted query string can't turn one
 *  request into an unbounded scan. */
const MAX_RANGE_DAYS = 62;

/** The viewer scope both feeds apply: everyone for admins/owners, own jobs otherwise. */
async function requireCalendarViewer() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const isAdmin =
    (session.user as any).role === "ADMIN" ||
    (session.user as any).role === "OWNER";

  return { session, isAdmin };
}

function calendarWhere(
  start: Date,
  end: Date,
  opts: { isAdmin: boolean; viewerId: string }
) {
  const where: any = {
    deletedAt: null,
    OR: [
      // jobDate within the span (end is exclusive — see getDayBounds)
      { jobDate: { gte: start, lt: end } },
      // startTime within the span
      { startTime: { gte: start, lt: end } },
    ],
  };

  if (!opts.isAdmin) {
    where.AND = [
      {
        OR: [
          { employeeId: opts.viewerId },
          { cleaners: { some: { id: opts.viewerId } } },
        ],
      },
    ];
  }

  return where;
}

export async function getJobsForDay(dateStr: string) {
  const { session, isAdmin } = await requireCalendarViewer();

  const { start, end } = getDayBounds(dateStr);

  const jobs = await db.job.findMany({
    where: calendarWhere(start, end, { isAdmin, viewerId: session.user.id }),
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

  // Resolve priority labels (R/I) + missing-equipment warnings. Admins see the
  // warning for every assigned cleaner; cleaners see it for their own kit.
  const { priority: priorityMap, missing: missingEquipmentMap } =
    await computeBadgeMaps(jobs, { isAdmin, viewerId: session.user.id });

  return jobs.map((job) =>
    toCalendarEvent(job, priorityMap, missingEquipmentMap)
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
  const { session, isAdmin } = await requireCalendarViewer();

  const { start } = getDayBounds(startStr);
  const { end } = getDayBounds(endStr);

  if (end <= start) {
    throw new Error("Invalid range");
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 25 * 3600_000) {
    throw new Error("Range too large");
  }

  const jobs = await db.job.findMany({
    where: calendarWhere(start, end, { isAdmin, viewerId: session.user.id }),
    select: CALENDAR_JOB_SELECT,
    // `id` last as a TIEBREAK. Without it two jobs sharing a jobDate and
    // startTime came back in whatever order the scan produced, which differs
    // between a one-day query and a one-month query (measured: 14 of 31 days
    // in August disagreed on ordering while holding identical id sets). The
    // range route has to be able to reproduce the per-day payload exactly.
    orderBy: [{ jobDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });

  const { priority: priorityMap, missing: missingEquipmentMap } =
    await computeBadgeMaps(jobs, { isAdmin, viewerId: session.user.id });

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
    const event = toCalendarEvent(job, priorityMap, missingEquipmentMap);
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

