"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { computeBadgeMaps } from "./_calendarBadges";
import { CALENDAR_JOB_SELECT } from "./_calendarSelect";
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
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  // Check user role - admins/owners can see all jobs
  const isAdmin =
    (session.user as any).role === "ADMIN" ||
    (session.user as any).role === "OWNER";

  // Build where clause — never show soft-deleted jobs on the calendar.
  const where: any = { deletedAt: null };

  if (!isAdmin) {
    // Regular employees see jobs where they are either the primary employee or a cleaner
    where.OR = [
      { employeeId: session.user.id },
      { cleaners: { some: { id: session.user.id } } }
    ];
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

  // Resolve priority labels (R/I) + missing-equipment warnings. Admins see the
  // warning for every assigned cleaner; cleaners see it for their own kit.
  const { priority: priorityMap, missing: missingEquipmentMap } =
    await computeBadgeMaps(jobs, { isAdmin, viewerId: session.user.id });

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
      metadata: {
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
  });
}

