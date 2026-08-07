import React from "react";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import {
  SAVED_ADDRESS_ORDER,
  SAVED_ADDRESS_SELECT,
} from "@/lib/client-address-store";
import CalendarPageClient from "./CalendarPageClient";
import CleanerCalendarClient from "./CleanerCalendarClient";
import { getBookingConfig } from "../../(book)/actions/getBookingConfig";
import { getTaxRates } from "@/lib/tax.server";
import { sanitizeCleanerNotes } from "@/lib/cleaner-notes";
import { calendarJobsWhere } from "@/lib/cleaner-jobs";

export default async function CalendarPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as any)?.role ?? "EMPLOYEE";
  const isEmployee = role === "EMPLOYEE";

  if (isEmployee && session) {
    const userId = session.user.id;

    // Same scope as My Jobs / the dashboard (see @/lib/cleaner-jobs): only jobs
    // this cleaner leads or is on, and never soft-deleted ones — the calendar
    // used to have no status filter and no deletedAt filter at all. Cancelled
    // jobs come through but the client hides them by default and never counts
    // them.
    const jobs = await db.job.findMany({
      where: calendarJobsWhere(userId),
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
        aptNumber: true,
        // Access notes (door / gate codes) for the cleaner's job drawer —
        // same need as the my-jobs page (item 2). This query is already
        // scoped by calendarJobsWhere(userId), so a cleaner only ever sees
        // codes for jobs they are actually on.
        clientAddress: { select: { accessNotes: true } },
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
        aptNumber: j.aptNumber ?? null,
        accessNotes: j.clientAddress?.accessNotes ?? null,
        employeePay: j.employeePay ?? null,
        // This branch is the CLEANER calendar (role === "EMPLOYEE" above, and
        // /cleaners/calendar routes here too), and the card it feeds also shows
        // "Cleaner pay" — so raw notes here leaked the booking's billing text to
        // exactly the audience item 10 says must never see it. Sanitized
        // SERVER-side so the raw string never reaches the client payload at all.
        notes: sanitizeCleanerNotes(j.notes),
        cleaners: j.cleaners.map((c) => c.name),
      }));

    return <CleanerCalendarClient jobs={calJobs} />;
  }

  // Admin/staff calendar — load the same lookups the Jobs page uses so the
  // New-job modal can search existing customers, assign cleaners, and offer
  // the add-on catalog.
  const [users, clients, bookingConfig, taxRates] = await Promise.all([
    db.user.findMany({
      // Staff only — exclude client-portal accounts (imported customers get a
      // CLIENT-role User row) and archived/deactivated users. This list feeds
      // the cleaner-assignment picker and the availability overlay picker.
      where: { role: { not: "CLIENT" }, deletedAt: null, isActive: true },
      orderBy: { name: "asc" },
      // allowedServiceCategories drives JobModal's category advisory (item 3).
      select: {
        id: true,
        name: true,
        email: true,
        allowedServiceCategories: true,
      },
    }),
    db.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        address: true,
        aptNumber: true,
        discountPercent: true,
        defaultPaymentMethodId: true,
        // The saved address book, so JobModal can offer the dropdown (item 2).
        addresses: {
          orderBy: SAVED_ADDRESS_ORDER,
          select: SAVED_ADDRESS_SELECT,
        },
      },
    }),
    getBookingConfig(),
    getTaxRates(),
  ]);

  return (
    <CalendarPageClient
      isEmployee={isEmployee}
      users={users}
      clients={clients}
      addOnCatalog={bookingConfig.addOns}
      taxRates={taxRates}
    />
  );
}
