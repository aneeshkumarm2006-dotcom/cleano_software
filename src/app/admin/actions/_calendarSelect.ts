import type { Prisma } from "@prisma/client";

/**
 * The ONLY Job columns the calendar grid needs (Stage 5 item 5).
 *
 * Both calendar feeds used `include` with no `select`, so every query pulled
 * all ~90 Job columns — taxes, Stripe ids, hold lifecycle, wash projections,
 * consent flags — and then threw all but these away when building `metadata`.
 * `getJobsForDay` runs once per visible day, so a month view paid that ~31
 * times over.
 *
 * Everything the *drawer* shows is fetched on open instead
 * (`getJobSummary`), which is why nothing here needs to grow again: if a panel
 * field is missing, it belongs in that action, not in the grid payload.
 *
 * Shared by getJobsForDay (the live path) and getJobsForCalendar so the two
 * cannot drift into disagreeing about what a calendar event carries.
 *
 * Every field below is load-bearing:
 *   • jobDate/startTime          — the `orderBy` and the day-bucket filter
 *   • endTime                    — the event's end, and the week/day card height
 *   • clientName/description     — the event title and description
 *   • employee/cleaners          — the event label + the assignee dot/initials
 *   • employeeId + priorityLabel — computeBadgeMaps (priority + missing kit)
 *   • the rest                   — read verbatim by the metadata block below,
 *                                  and thence by status-meta/EventCard/ListView
 */
export const CALENDAR_JOB_SELECT = {
  id: true,
  clientName: true,
  description: true,
  jobDate: true,
  startTime: true,
  endTime: true,
  status: true,
  jobType: true,
  location: true,
  aptNumber: true,
  price: true,
  employeePay: true,
  totalTip: true,
  parking: true,
  paymentReceived: true,
  invoiceSent: true,
  notes: true,
  priorityLabel: true,
  rescheduleRequestedAt: true,
  employeeId: true,
  employee: { select: { id: true, name: true, email: true } },
  cleaners: { select: { id: true, name: true } },
} satisfies Prisma.JobSelect;

/** A row as the two calendar feeds see it. */
export type CalendarJobRow = Prisma.JobGetPayload<{
  select: typeof CALENDAR_JOB_SELECT;
}>;
