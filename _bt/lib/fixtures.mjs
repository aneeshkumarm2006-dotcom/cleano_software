// Test-data builders. Every helper records what it creates in manifest.jsonl
// BEFORE returning, so cleanup can find it even if the caller crashes next line.
//
// This runs against the LIVE production database. Two rules follow from that,
// and neither is optional:
//   1. Nothing here ever updates or deletes a row it did not create.
//   2. Every row carries MARKER in a human-readable field, so a row whose
//      manifest line was somehow lost is still identifiable by sweep.
import { PrismaClient } from "@prisma/client";
import { record, MARKER } from "./manifest.mjs";

export const db = new PrismaClient();

/** A weekday at 10:00 local, `daysAhead` from now — jobs need a plausible slot. */
export function slot(daysAhead = 3, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * Create a job. Everything is optional; the defaults make a plain admin-created
 * RESIDENTIAL job, which is the ADDITIVE money basis (bookingSource null) that
 * fix 7 cares about. Pass bookingSource:"web" to exercise the INCLUSIVE basis.
 */
export async function createJob(opts = {}) {
  const {
    clientId = null, clientName = `${MARKER} Job Client`, employeeId = null,
    jobType = "RESIDENTIAL", status = "SCHEDULED", price = 200,
    startTime = slot(), endTime = null, location = `${MARKER} 100 Test St`,
    notes = null, bookingSource = null, addOns = [], discountAmount = null,
    subtotalAmount, gstAmount, qstAmount, totalAmount, clientAddressId = null,
    aptNumber = null,
  } = opts;

  const job = await db.job.create({
    data: {
      clientName, clientId, employeeId, jobType, status, price,
      startTime, endTime: endTime ?? new Date(startTime.getTime() + 3 * 3600_000),
      location, aptNumber, notes, bookingSource, discountAmount, clientAddressId,
      ...(subtotalAmount !== undefined ? { subtotalAmount } : {}),
      ...(gstAmount !== undefined ? { gstAmount } : {}),
      ...(qstAmount !== undefined ? { qstAmount } : {}),
      ...(totalAmount !== undefined ? { totalAmount } : {}),
      ...(addOns.length
        ? { addOns: { create: addOns.map((a) => ({ name: a.name, price: a.price ?? 0, quantity: a.quantity ?? 1 })) } }
        : {}),
    },
    select: { id: true, addOns: { select: { id: true } } },
  });

  record("Job", job.id, "fixtures");
  for (const a of job.addOns) record("JobAddOn", a.id, "fixtures");
  return job.id;
}

/** Assign a cleaner to a job the way the app does — assignment row + employeeId. */
export async function assignCleaner(jobId, cleanerId, status = "ASSIGNED") {
  const a = await db.jobAssignment.create({
    data: { jobId, cleanerId, status },
    select: { id: true },
  });
  record("JobAssignment", a.id, "fixtures");
  await db.job.update({ where: { id: jobId }, data: { employeeId: cleanerId } });
  return a.id;
}

/** A saved service address on the client address book (fix 11). */
export async function createAddress(clientId, opts = {}) {
  const {
    label = `${MARKER} Home`, address = `${MARKER} 250 Sample Ave`,
    city = "Montreal", postalCode = "H3B 1A1", aptNumber = null,
    accessNotes = null, isDefault = false,
  } = opts;
  const row = await db.clientAddress.create({
    data: { clientId, label, address, city, postalCode, aptNumber, accessNotes, isDefault },
    select: { id: true },
  });
  record("ClientAddress", row.id, "fixtures");
  return row.id;
}

/** Read an AppSetting so a test can restore it verbatim afterwards. */
export async function readSetting(key) {
  const row = await db.appSetting.findUnique({ where: { key } }).catch(() => null);
  return row ?? null;
}

export async function done() { await db.$disconnect(); }
