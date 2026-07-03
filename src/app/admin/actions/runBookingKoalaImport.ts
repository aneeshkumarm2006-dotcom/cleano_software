"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { hashPassword } from "better-auth/crypto";
import {
  sendCustomerImportWelcome,
  sendCleanerImportWelcome,
} from "@/lib/email";
import { logActivity } from "@/lib/activity-log";
import {
  parseAndNormalize,
  aggregateCustomers,
  collectCleaners,
  cleanerKey,
  makeTempPassword,
  BOOKING_SOURCE,
  type ImportReport,
} from "@/lib/bookingkoala/core";

/**
 * Server-side BookingKoala import behind the admin "Import from BookingKoala"
 * button. Runs on the server, so email links use the deployed NEXT_PUBLIC_APP_URL
 * (no localhost). Dry-run by default — pass commit:true to write + email.
 */
export async function runBookingKoalaImport(
  csvText: string,
  opts: {
    commit: boolean;
    /** Email cleaners their login (default true). */
    sendCleanerEmails?: boolean;
    /** Email customers their login (default true). Client can turn this off. */
    sendCustomerEmails?: boolean;
    /**
     * Process only a slice of the in-range rows — keeps each request well under
     * the serverless timeout. The UI drives a full commit as a sequence of these
     * (rows 0–99, 100–199, …). Omit to process the whole file (used for dry-run).
     * Cleaner/customer find-or-create and job dedup are idempotent across slices,
     * so batching is safe and re-runnable.
     */
    batch?: { start: number; size: number };
  }
): Promise<ImportReport> {
  const empty = (): ImportReport => ({
    ok: false,
    dryRun: !opts.commit,
    parsedCount: 0,
    droppedCount: 0,
    problemRows: [],
    mojibakeCount: 0,
    cleaners: { created: 0, existing: 0, skipped: 0, failed: 0 },
    customers: { created: 0, existing: 0, failed: 0 },
    addresses: 0,
    jobs: { created: 0, skipped: 0, failed: 0 },
    statusCounts: {},
    emails: { sent: 0, failed: 0 },
    sample: [],
    failures: [],
  });

  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { ...empty(), error: "Not authorized" };
  }

  const commit = opts.commit;
  const sendCleanerEmails = commit && opts.sendCleanerEmails !== false;
  const sendCustomerEmails = commit && opts.sendCustomerEmails !== false;

  let parsed;
  try {
    parsed = parseAndNormalize(csvText);
  } catch (e) {
    return { ...empty(), error: `Could not parse CSV: ${(e as Error).message}` };
  }
  if (parsed.rows.length === 0) {
    return {
      ...empty(),
      error: "No valid bookings found in the file (check the Booking start date/time column).",
      parsedCount: parsed.parsedCount,
      droppedCount: parsed.droppedCount,
      problemRows: parsed.problemRows,
    };
  }

  const report: ImportReport = { ...empty(), ok: true, dryRun: !commit };
  report.parsedCount = parsed.parsedCount;
  report.droppedCount = parsed.droppedCount;
  report.problemRows = parsed.problemRows;
  report.mojibakeCount = parsed.mojibakeCount;
  report.totalRows = parsed.rows.length;
  const failures: string[] = [];

  // Slice for batched commits — the UI sends rows 0–99, 100–199, … so each
  // request finishes before the serverless timeout. Cleaners/customers are
  // derived from (and created for) only the rows in this slice; find-or-create
  // + booking-id dedup make overlapping/re-run slices safe.
  const rows = opts.batch
    ? parsed.rows.slice(opts.batch.start, opts.batch.start + opts.batch.size)
    : parsed.rows;

  // ── 1. cleaners ────────────────────────────────────────────────────────────
  const cleanerUserId = new Map<string, string | null>();
  const cleanerCreds: { name: string; email: string; tempPassword: string }[] = [];
  for (const p of collectCleaners(rows)) {
    const key = cleanerKey(p);
    if (!p.email) {
      report.cleaners.skipped++;
      cleanerUserId.set(key, null);
      continue;
    }
    try {
      const existing = await db.user.findUnique({ where: { email: p.email } });
      if (existing) {
        report.cleaners.existing++;
        cleanerUserId.set(key, existing.id);
        continue;
      }
      if (!commit) {
        report.cleaners.created++;
        cleanerUserId.set(key, null);
        continue;
      }
      const tempPassword = makeTempPassword();
      const user = await db.user.create({
        data: {
          name: p.name,
          email: p.email,
          phone: p.phone,
          emailVerified: true,
          isActive: true,
          role: "EMPLOYEE",
          // Force the cleaner to retire the shared temp password on first login.
          mustChangePassword: true,
        },
      });
      await db.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: await hashPassword(tempPassword),
        },
      });
      cleanerUserId.set(key, user.id);
      cleanerCreds.push({ name: p.name, email: p.email, tempPassword });
      report.cleaners.created++;
    } catch (e) {
      report.cleaners.failed++;
      failures.push(`cleaner ${p.email}: ${(e as Error).message}`);
    }
  }

  // ── 2. customers + addresses + logins ───────────────────────────────────────
  const clientIdByKey = new Map<string, string | null>();
  const custCreds: { name: string; email: string; tempPassword: string }[] = [];
  for (const agg of aggregateCustomers(rows)) {
    try {
      const primary = agg.addresses[0] ?? null;
      const existing = agg.email
        ? await db.client.findFirst({ where: { email: agg.email } })
        : await db.client.findFirst({
            where: { name: agg.name, phone: agg.phone ?? undefined },
          });

      if (!commit) {
        clientIdByKey.set(agg.key, existing?.id ?? null);
        existing ? report.customers.existing++ : report.customers.created++;
        report.addresses += agg.addresses.length;
        continue;
      }

      let clientId: string;
      if (existing) {
        report.customers.existing++;
        clientId = existing.id;
        await db.client.update({
          where: { id: existing.id },
          data: {
            ...(existing.phone ? {} : agg.phone ? { phone: agg.phone } : {}),
            ...(existing.company ? {} : agg.company ? { company: agg.company } : {}),
            ...(existing.address || !primary ? {} : { address: primary.address }),
            ...(existing.city || !primary?.city ? {} : { city: primary.city }),
            ...(existing.state || !primary?.state ? {} : { state: primary.state }),
            ...(existing.zip || !primary?.zip ? {} : { zip: primary.zip }),
          },
        });
      } else {
        const created = await db.client.create({
          data: {
            name: agg.name,
            email: agg.email,
            phone: agg.phone,
            company: agg.company,
            clientType: agg.clientType,
            isActive: true,
            address: primary?.address ?? null,
            aptNumber: primary?.apt ?? null,
            city: primary?.city ?? null,
            state: primary?.state ?? null,
            zip: primary?.zip ?? null,
          },
        });
        clientId = created.id;
        report.customers.created++;
      }

      // Addresses (idempotent).
      const existingAddrs = await db.clientAddress.findMany({
        where: { clientId },
        select: { address: true },
      });
      const have = new Set(
        existingAddrs.map((a) => a.address.toLowerCase().replace(/\s+/g, " "))
      );
      for (let i = 0; i < agg.addresses.length; i++) {
        const a = agg.addresses[i];
        const display = a.apt ? `${a.apt} – ${a.address}` : a.address;
        if (have.has(display.toLowerCase().replace(/\s+/g, " "))) continue;
        await db.clientAddress.create({
          data: {
            clientId,
            label: i === 0 ? "Home" : `Address ${i + 1}`,
            address: display,
            aptNumber: a.apt,
            isDefault: i === 0,
          },
        });
        report.addresses++;
      }

      // Customer login (forced reset on first login).
      if (agg.email) {
        const cred = await ensureCustomerLogin(agg.name, agg.email, clientId);
        if (cred) custCreds.push({ name: agg.name, email: agg.email, tempPassword: cred });
      }

      clientIdByKey.set(agg.key, clientId);
    } catch (e) {
      report.customers.failed++;
      clientIdByKey.set(agg.key, null);
      failures.push(`customer ${agg.email ?? agg.name}: ${(e as Error).message}`);
    }
  }

  // ── 3. jobs ──────────────────────────────────────────────────────────────────
  // Dedup on BookingKoala's unique booking id, NOT customer+time — one client
  // (e.g. a property manager) can have several distinct bookings at the same
  // time, and those must all import. Fall back to customer+time only when a row
  // has no booking id.
  const seen = new Set<string>();
  for (const r of rows) {
    const dedupKey = r.job.bookingId
      ? `bk:${r.job.bookingId}`
      : `${r.customerKey}|${r.job.startTime.toISOString()}`;
    if (seen.has(dedupKey)) {
      report.jobs.skipped++;
      continue;
    }
    seen.add(dedupKey);

    const clientId = clientIdByKey.get(r.customerKey) ?? null;
    const cleanerIds = r.providers
      .map((p) => cleanerUserId.get(cleanerKey(p)))
      .filter((id): id is string => !!id);

    report.statusCounts[r.job.status] = (report.statusCounts[r.job.status] || 0) + 1;
    if (report.sample.length < 20) {
      report.sample.push({
        row: r.rowNum,
        client: r.job.clientName,
        jobType: r.job.jobType,
        start: r.job.startTime.toISOString().slice(0, 16),
        price: r.job.price,
        status: r.job.status,
        cleaners: cleanerIds.length || r.providers.length,
      });
    }

    if (!commit) {
      report.jobs.created++;
      continue;
    }

    try {
      // Re-import idempotency: skip only an exact same booking (by external id),
      // never a different booking that merely shares a client + time.
      if (r.job.bookingId) {
        const dup = await db.job.findFirst({
          where: { externalBookingId: r.job.bookingId, bookingSource: BOOKING_SOURCE },
          select: { id: true },
        });
        if (dup) {
          report.jobs.skipped++;
          continue;
        }
      } else if (clientId) {
        const dup = await db.job.findFirst({
          where: { clientId, startTime: r.job.startTime, bookingSource: BOOKING_SOURCE },
          select: { id: true },
        });
        if (dup) {
          report.jobs.skipped++;
          continue;
        }
      }
      const created = await db.job.create({
        data: {
          clientName: r.job.clientName,
          ...(clientId ? { client: { connect: { id: clientId } } } : {}),
          location: r.job.location,
          aptNumber: r.job.aptNumber,
          description: `${r.job.jobType} cleaning`,
          jobType: r.job.jobType,
          jobDate: r.job.startTime,
          startTime: r.job.startTime,
          endTime: r.job.endTime,
          status: r.job.status,
          price: r.job.price,
          subtotalAmount: r.job.subtotalAmount,
          totalAmount: r.job.totalAmount,
          gstAmount: 0,
          qstAmount: 0,
          tipAmount: r.job.tipAmount,
          totalTip: r.job.totalTip,
          parking: r.job.parking,
          discountAmount: r.job.discountAmount,
          appliedPromoCode: r.job.appliedPromoCode,
          bedCount: r.job.bedCount,
          bathCount: r.job.bathCount,
          halfBathCount: r.job.halfBathCount,
          squareFootage: r.job.squareFootage,
          paymentType: r.job.paymentType,
          isCashJob: r.job.isCashJob,
          paymentReceived: r.job.paymentReceived,
          paidAt: r.job.paymentReceived ? r.job.startTime : null,
          refundedAmount: r.job.refundedAmount,
          employeePay: r.job.employeePay,
          requiredCleaners: r.job.requiredCleaners,
          bookingSource: BOOKING_SOURCE,
          externalBookingId: r.job.bookingId,
          notes: r.job.notes,
          ...(cleanerIds.length
            ? {
                employee: { connect: { id: cleanerIds[0] } },
                cleaners: { connect: cleanerIds.map((id) => ({ id })) },
              }
            : {}),
        },
      });
      // Internal traceability — NOTE_ADDED is excluded from the customer portal
      // feed, so the source + team payout never show to customers or cleaners.
      await db.jobLog
        .create({
          data: { jobId: created.id, action: "NOTE_ADDED", description: r.job.importNote },
        })
        .catch(() => {});
      report.jobs.created++;
    } catch (e) {
      report.jobs.failed++;
      failures.push(`row ${r.rowNum}: ${(e as Error).message}`);
    }
  }

  // ── 4. emails (commit only) ──────────────────────────────────────────────────
  // Cleaner and customer welcome emails are toggled independently. Each send is
  // logged to the audit trail (event only — the password itself is NEVER recorded).
  if (sendCleanerEmails) {
    for (const c of cleanerCreds) {
      const res = await sendCleanerImportWelcome({ to: c.email, name: c.name, tempPassword: c.tempPassword });
      res?.ok ? report.emails.sent++ : report.emails.failed++;
      await logActivity({
        category: "EMAIL",
        action: "import_temp_password_email",
        status: res?.ok ? "SUCCESS" : "FAILED",
        actorLabel: c.email,
        message: `Temporary-password welcome email ${res?.ok ? "sent" : "failed"} to cleaner ${c.name} <${c.email}>.`,
      });
    }
  }
  if (sendCustomerEmails) {
    for (const c of custCreds) {
      const res = await sendCustomerImportWelcome({ to: c.email, name: c.name, tempPassword: c.tempPassword });
      res?.ok ? report.emails.sent++ : report.emails.failed++;
      await logActivity({
        category: "EMAIL",
        action: "import_temp_password_email",
        status: res?.ok ? "SUCCESS" : "FAILED",
        actorLabel: c.email,
        message: `Temporary-password welcome email ${res?.ok ? "sent" : "failed"} to customer ${c.name} <${c.email}>.`,
      });
    }
  }

  report.failures = failures.slice(0, 50);
  if (commit) {
    revalidatePath("/admin/clients");
    revalidatePath("/admin/calendar");
    revalidatePath("/admin/jobs");
  }
  return report;
}

/**
 * Ensure a customer has a portal login with a forced first-login reset. Returns
 * the temp password only when a fresh credential was minted (so we know to email it).
 */
async function ensureCustomerLogin(
  name: string,
  email: string,
  clientId: string
): Promise<string | null> {
  const existing = await db.user.findUnique({
    where: { email },
    include: { accounts: true },
  });
  if (existing) {
    if (existing.role === "EMPLOYEE") {
      await db.user.update({ where: { id: existing.id }, data: { role: "CLIENT" } });
    }
    await db.client.update({ where: { id: clientId }, data: { userId: existing.id } });
    if (existing.accounts.some((a) => a.providerId === "credential")) return null;
    const tempPassword = makeTempPassword();
    await db.account.create({
      data: {
        userId: existing.id,
        accountId: existing.id,
        providerId: "credential",
        password: await hashPassword(tempPassword),
      },
    });
    await db.user.update({ where: { id: existing.id }, data: { mustChangePassword: true } });
    return tempPassword;
  }
  const tempPassword = makeTempPassword();
  const user = await db.user.create({
    data: { name, email, emailVerified: true, isActive: true, role: "CLIENT", mustChangePassword: true },
  });
  await db.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword(tempPassword),
    },
  });
  await db.client.update({ where: { id: clientId }, data: { userId: user.id } });
  return tempPassword;
}
