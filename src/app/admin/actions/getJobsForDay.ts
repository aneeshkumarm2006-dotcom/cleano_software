"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { computeBadgeMaps } from "./_calendarBadges";

// Utility to clamp a date to start/end of day in local time
function getDayBounds(dateStr: string) {
  const day = new Date(dateStr);
  if (Number.isNaN(day.getTime())) {
    throw new Error("Invalid date");
  }
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// The shared calendar components position events with browser-local
// getHours()/getDate() and render labels in browser-local time. To make them
// show the BUSINESS timezone (America/Toronto) for every viewer regardless of
// their own tz, we hand them a "floating" datetime string (no Z) whose
// components are the Toronto wall-clock of the true instant. Parsed as local,
// getHours() then yields the Toronto hour and a plain local label shows Toronto
// time — consistent for all viewers.
function toBusinessWallClock(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  // Intl can emit "24" for midnight; normalize to "00".
  const hh = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}:${get("second")}.000`;
}

export async function getJobsForDay(dateStr: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const isAdmin =
    (session.user as any).role === "ADMIN" ||
    (session.user as any).role === "OWNER";

  const { start, end } = getDayBounds(dateStr);

  const where: any = {
    deletedAt: null,
    OR: [
      // jobDate within day
      { jobDate: { gte: start, lte: end } },
      // startTime within day
      { startTime: { gte: start, lte: end } },
    ],
  };

  if (!isAdmin) {
    where.AND = [
      {
        OR: [
          { employeeId: session.user.id },
          { cleaners: { some: { id: session.user.id } } },
        ],
      },
    ];
  }

  const jobs = await db.job.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      cleaners: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ jobDate: "asc" }, { startTime: "asc" }],
  });

  // Resolve priority labels (R/I) + missing-equipment warnings. Admins see the
  // warning for every assigned cleaner; cleaners see it for their own kit.
  const { priority: priorityMap, missing: missingEquipmentMap } =
    await computeBadgeMaps(jobs, { isAdmin, viewerId: session.user.id });

  return jobs.map((job) => {
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
        job.status === "IN_PROGRESS"
          ? 5
          : job.status === "SCHEDULED"
          ? 3
          : 1,
      metadata: {
        jobId: job.id,
        jobType: job.jobType,
        location: job.location,
        // Unit number on calendar cards + the job popover (item 2). `location`
        // stays the bare street: shortLocation() comma-splits it for the card
        // label, and folding the unit in would break that.
        aptNumber: job.aptNumber,
        status: job.status,
        price: job.price,
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

