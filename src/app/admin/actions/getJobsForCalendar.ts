"use server";

import { db } from "@/lib/org-db";
import { computeBadgeMaps } from "./_calendarBadges";
import { CALENDAR_JOB_SELECT } from "./_calendarSelect";
import {
  calendarScopeFilter,
  projectCalendarMetadata,
  resolveCalendarViewer,
} from "./_calendarScope";
import { activeSubtotal } from "@/lib/job-money";

/**
 * Range variant of the calendar feed.
 *
 * NOTE: still nothing calls this. The live path is now
 * `/api/calendar/range` → `useCalendarData` → `getJobsForRange` (one request
 * for the whole visible span); `/api/calendar/[date]` → `getJobsForDay` remains
 * for single-day callers and as the hook's fallback. This function predates
 * both and returns a FLAT list rather than a per-day grouping, which is why it
 * was not the one wired up. It is kept only so the two column lists cannot
 * drift — that is what `CALENDAR_JOB_SELECT` is for — and it must stay
 * byte-identical in output to `getJobsForDay` if it is ever revived.
 */
export async function getJobsForCalendar(startDate?: Date, endDate?: Date) {
  // Same resolved viewer the live feed uses (Stage 7): scope AND money
  // visibility come from one object, so this dormant twin cannot drift back into
  // handing a field lead their group's prices if it is ever revived.
  const viewer = await resolveCalendarViewer();

  // Build where clause — never show soft-deleted jobs on the calendar.
  const where: any = { deletedAt: null };

  const scoped = calendarScopeFilter(viewer);
  if (scoped) {
    where.AND = [scoped];
  }

  // Add date range filter if provided
  if (startDate || endDate) {
    where.AND = where.AND || [];

    if (startDate && endDate) {
      where.AND.push({
        OR: [
          // Jobs with jobDate in range
          {
            jobDate: {
              gte: startDate,
              lte: endDate,
            },
          },
          // Jobs with startTime in range
          {
            startTime: {
              gte: startDate,
              lte: endDate,
            },
          },
        ],
      });
    } else if (startDate) {
      where.AND.push({
        OR: [
          { jobDate: { gte: startDate } },
          { startTime: { gte: startDate } },
        ],
      });
    } else if (endDate) {
      where.AND.push({
        OR: [
          { jobDate: { lte: endDate } },
          { startTime: { lte: endDate } },
        ],
      });
    }
  }

  const jobs = await db.job.findMany({
    where,
    // Explicit select (Stage 5 item 5) — see _calendarSelect.ts. This used to
    // be an `include`, i.e. every column of every job in the month.
    select: CALENDAR_JOB_SELECT,
    orderBy: [
      { jobDate: "asc" },
      { startTime: "asc" },
    ],
  });

  // Resolve priority labels (R/I) + missing-equipment warnings. Admins and field
  // leads see the warning for every assigned cleaner on the jobs already in
  // scope; a cleaner sees it for their own kit.
  const { priority: priorityMap, missing: missingEquipmentMap } =
    await computeBadgeMaps(jobs, {
      allAssignedCleaners: viewer.allAssignedCleaners,
      viewerId: viewer.viewerId,
    });

  // Transform jobs to calendar event format
  return jobs.map((job) => {
    // Create start time by combining date with startTime
    const start = new Date(job.startTime);

    // Create end time if available
    const end = job.endTime ? new Date(job.endTime) : undefined;

    // Create cleaner names string
    const cleanerNames = job.cleaners.map((c) => c.name).join(", ");
    const label = cleanerNames || (job.employee?.name ?? "Unassigned");

    return {
      id: job.id,
      title: job.clientName,
      description: job.description || undefined,
      label: label,
      start: start.toISOString(),
      end: end?.toISOString(),
      confirmed: job.status !== "CREATED" && job.status !== "CANCELLED",
      importance: job.status === "IN_PROGRESS" ? 5 : job.status === "SCHEDULED" ? 3 : 1,
      // Money nulled + notes sanitized for viewers who aren't OWNER/ADMIN.
      metadata: projectCalendarMetadata({
        jobId: job.id,
        jobType: job.jobType,
        location: job.location,
        // Read by CalendarJobActions' address line — without it the unit number
        // silently drops off the calendar modal (item 2).
        aptNumber: job.aptNumber,
        status: job.status,
        // `priceLabel` prints this on the card. It is the ACTIVE value of the
        // job (fix 3), not the base line — one figure, same as the job page.
        price: activeSubtotal(job),
        // Stage 8 — kept byte-identical to getJobsForDay's block. `price` above
        // is already the hourly total, because `activeSubtotal` derives it;
        // these two exist so the card can SAY it is hourly. The rate is not
        // here: it is a price, and `projectCalendarMetadata` redacts it.
        billingType: job.billingType,
        billedHourlyRate: job.billedHourlyRate,
        billedHours: job.billedActualHours ?? job.billedEstimatedHours,
        // Stage 9 — kept byte-identical to getJobsForDay's line, same reason as
        // the block above: the live feed and the prefetched one must not
        // disagree about what a card says.
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
  });
}

