import React from "react";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import CalendarPageClient from "./CalendarPageClient";
import CleanerCalendarClient from "./CleanerCalendarClient";

export default async function CalendarPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as any)?.role ?? "EMPLOYEE";
  const isEmployee = role === "EMPLOYEE";

  if (isEmployee && session) {
    const userId = session.user.id;

    const jobs = await db.job.findMany({
      where: {
        OR: [
          { employeeId: userId },
          { cleaners: { some: { id: userId } } },
        ],
      },
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        jobDate: true,
        startTime: true,
        endTime: true,
        status: true,
        jobType: true,
        location: true,
        employeePay: true,
        notes: true,
        cleaners: { select: { id: true, name: true } },
      },
      orderBy: { jobDate: "asc" },
    });

    const calJobs = jobs
      .filter((j) => j.jobDate != null)
      .map((j) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        clientName: j.clientName,
        date: j.jobDate!.toISOString(),
        startTime: j.startTime?.toISOString() ?? null,
        endTime: j.endTime?.toISOString() ?? null,
        status: j.status,
        jobType: j.jobType,
        location: j.location ?? null,
        employeePay: j.employeePay ?? null,
        notes: j.notes ?? null,
        cleaners: j.cleaners.map((c) => c.name),
      }));

    return <CleanerCalendarClient jobs={calJobs} />;
  }

  return <CalendarPageClient isEmployee={isEmployee} />;
}
