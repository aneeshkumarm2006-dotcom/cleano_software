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
  // The card's price label is the ACTIVE value of the job — base + add-ons, or
  // the override total (fix 3) — so these five travel with the row. This is the
  // one deliberate exception to the "lean select" rule above: the grid PRINTS a
  // dollar figure, and a calendar reading $128 beside a job page reading $186
  // is exactly the mismatch the fix exists to close. `addOns` is a join, but
  // only name/price/quantity, and only for the days on screen.
  price: true,
  discountAmount: true,
  subtotalAmount: true,
  bookingSource: true,
  pricingMode: true,
  addOns: { select: { name: true, price: true, quantity: true } },
  // Stage 8 — part of the same exception. `activeSubtotal` derives an hourly
  // job's value from these four, so a card without them would print the mirror
  // in `price` and go stale the moment the crew's hours were snapshotted. The
  // event card also carries an "Hourly" badge off `billingType`.
  billingType: true,
  billedHourlyRate: true,
  billedEstimatedHours: true,
  billedActualHours: true,
  // Stage 9 — the card prints an "Apt"/"House" tag. One nullable enum, and it
  // is not money: a field lead sorting a day's route needs to know which stops
  // are walk-ups, and knowing that reveals no dollar figure. Hence it is NOT on
  // REDACTED_CALENDAR_KEYS, for the same reason `billingType` isn't.
  propertyType: true,
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
