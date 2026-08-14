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
import { notifyAdmins } from "@/lib/admin-alerts";
import { resolveBkAddOns } from "@/lib/addon-catalog";
import { upsertClientAddress } from "@/lib/client-address-store";
import { getBookingConfig } from "@/app/(book)/actions/getBookingConfig";
import { getTaxRates, computeJobTaxes } from "@/lib/tax.server";
import { jobTypeLabel } from "@/lib/calendar-labels";
import { startOfDayTz } from "@/lib/time";
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
     * OPT-IN (default OFF): also skip a row when that client already has a
     * non-deleted job on the same calendar DAY. Off by default because a
     * property-manager client legitimately books several distinct cleanings on
     * one day — turning this on would silently drop them. See the dedup notes
     * in section 3 below.
     */
    skipSameDayDuplicates?: boolean;
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
    jobs: { created: 0, skipped: 0, failed: 0, duplicates: 0, sameDay: 0 },
    statusCounts: {},
    addOns: { created: 0, matched: 0, unmatched: 0 },
    addOnsNeedingReview: [],
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
  const skipSameDay = opts.skipSameDayDuplicates === true;

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

      // Addresses (idempotent) — via the shared upsert, which owns the
      // normalised, unit-aware de-duplication and the "first one is the
      // default" rule (src/lib/client-address-store.ts).
      //
      // Fixed here (awerfixes.pdf item 2, round 3, stage 4): this loop used to
      // build `display = "Apt 12 – 4820 Sherbrooke"` and write it to `address`
      // WHILE ALSO setting `aptNumber: "Apt 12"`, so every surface that prints
      // the street then the unit showed the unit twice. The street now goes in
      // clean and the unit lives only in `aptNumber`. Existing rows imported
      // the old way are not rewritten — nothing backfills them — but
      // stripDuplicatedApt() makes them render correctly anyway, and their
      // normalised key still matches, so re-importing won't duplicate them.
      const existingAddrIds = new Set(
        (
          await db.clientAddress.findMany({
            where: { clientId },
            select: { id: true },
          })
        ).map((a) => a.id)
      );
      for (let i = 0; i < agg.addresses.length; i++) {
        const a = agg.addresses[i];
        const id = await upsertClientAddress(clientId, {
          label: i === 0 ? "Home" : `Address ${i + 1}`,
          address: a.address,
          aptNumber: a.apt,
          city: a.city,
          postalCode: a.zip,
        });
        if (id && !existingAddrIds.has(id)) {
          existingAddrIds.add(id);
          report.addresses++;
        }
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
  //
  // The optional `skipSameDayDuplicates` guard (default OFF) additionally skips
  // a row when the client already has a job on the same calendar DAY. It is
  // opt-in precisely because it WOULD drop those legitimate same-day bookings.
  const seen = new Set<string>();
  // Same-day keys claimed by rows earlier in THIS file (only used when the
  // opt-in guard is on) — so two same-day rows in one upload also collapse.
  const seenSameDay = new Set<string>();
  const taxRates = await getTaxRates();
  // The add-on catalog, loaded ONCE for the whole run. Used to match imported
  // add-on names so they carry the canonical Cleano spelling that checklist
  // triggers and equipment kits key off.
  const { addOns: addOnCatalog } = await getBookingConfig();
  for (const r of rows) {
    const dedupKey = r.job.bookingId
      ? `bk:${r.job.bookingId}`
      : `${r.customerKey}|${r.job.startTime.toISOString()}`;
    if (seen.has(dedupKey)) {
      report.jobs.skipped++;
      report.jobs.duplicates++;
      continue;
    }
    seen.add(dedupKey);

    if (skipSameDay) {
      const dayKey = `${r.customerKey}|${dayBounds(r.job.startTime).key}`;
      if (seenSameDay.has(dayKey)) {
        report.jobs.skipped++;
        report.jobs.sameDay++;
        continue;
      }
      seenSameDay.add(dayKey);
    }

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

    // Resolved BEFORE the dry-run bail-out, so a dry run can show the admin
    // which names need pricing — the whole point of running one first.
    const resolvedAddOns = resolveBkAddOns(r.job.addOns, addOnCatalog);
    report.addOns.created += resolvedAddOns.rows.length;
    report.addOns.matched +=
      resolvedAddOns.rows.length - resolvedAddOns.review.length;
    report.addOns.unmatched += resolvedAddOns.review.length;
    for (const a of resolvedAddOns.review) {
      if (report.addOnsNeedingReview.length >= 50) break;
      report.addOnsNeedingReview.push({
        name: a.name,
        quantity: a.quantity,
        source: a.source,
        rowNum: r.rowNum,
        bookingId: r.job.bookingId,
      });
    }

    if (!commit) {
      report.jobs.created++;
      continue;
    }

    try {
      // Re-import idempotency: skip only an exact same booking (by external id),
      // never a different booking that merely shares a client + time.
      //
      // `deletedAt: null` is load-bearing: without it an ARCHIVED (soft-deleted)
      // job matched here and the row was reported as a duplicate skip, so an
      // archived booking could never be re-imported. Only a LIVE job blocks a
      // re-import.
      if (r.job.bookingId) {
        const dup = await db.job.findFirst({
          where: {
            externalBookingId: r.job.bookingId,
            bookingSource: BOOKING_SOURCE,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (dup) {
          report.jobs.skipped++;
          report.jobs.duplicates++;
          continue;
        }
      } else if (clientId) {
        const dup = await db.job.findFirst({
          where: {
            clientId,
            startTime: r.job.startTime,
            bookingSource: BOOKING_SOURCE,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (dup) {
          report.jobs.skipped++;
          report.jobs.duplicates++;
          continue;
        }
      }

      // Opt-in guard: this client already has a live job somewhere on the same
      // calendar day. Any source, not just BookingKoala — the point is "don't
      // double-book this client today".
      if (skipSameDay && clientId) {
        const { start, end } = dayBounds(r.job.startTime);
        const sameDay = await db.job.findFirst({
          where: {
            clientId,
            deletedAt: null,
            startTime: { gte: start, lt: end },
          },
          select: { id: true },
        });
        if (sameDay) {
          report.jobs.skipped++;
          report.jobs.sameDay++;
          continue;
        }
      }
      // GST/QST from the admin-configured rates on the discounted subtotal
      // (cash rows stay tax exempt). The BookingKoala CSV's final amount is
      // what was actually charged — trust it as totalAmount when it differs
      // from the subtotal (it already includes tax); otherwise use our
      // computed subtotal + tax.
      const taxes = computeJobTaxes(
        r.job.subtotalAmount - (r.job.discountAmount ?? 0),
        taxRates,
        r.job.isCashJob
      );
      const csvTotalHasTax =
        r.job.totalAmount > 0 &&
        Math.abs(r.job.totalAmount - r.job.subtotalAmount) > 0.01;
      const created = await db.job.create({
        data: {
          clientName: r.job.clientName,
          ...(clientId ? { client: { connect: { id: clientId } } } : {}),
          location: r.job.location,
          aptNumber: r.job.aptNumber,
          description: `${jobTypeLabel(r.job.jobType)} cleaning`,
          jobType: r.job.jobType,
          jobDate: r.job.startTime,
          startTime: r.job.startTime,
          endTime: r.job.endTime,
          status: r.job.status,
          price: r.job.price,
          subtotalAmount: taxes.subtotalAmount,
          totalAmount: csvTotalHasTax ? r.job.totalAmount : taxes.totalAmount,
          gstAmount: taxes.gstAmount,
          qstAmount: taxes.qstAmount,
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
          // D2 — the CSV's "Provider/team payment" is what BookingKoala actually
          // paid this crew, so it is an authoritative TEAM TOTAL, not a
          // save-time estimate: `computeJobPayShares` splits it evenly instead
          // of running the tier math, and the job page labels it "Manual amount"
          // instead of the "Stored value — not used" row the PDF complains about.
          employeePayIsManual: r.job.employeePay != null,
          requiredCleaners: r.job.requiredCleaners,
          bookingSource: BOOKING_SOURCE,
          // FINAL_PRICE on every imported job (cleano_new_fixes.pdf fix 2 names
          // this default explicitly). The CSV's service total is what
          // BookingKoala actually billed — extras included — so the add-on rows
          // created below are an ITEMISATION of it and must never add to it.
          // Stamping it makes that survive an admin retyping the price, which
          // is exactly what the old provenance-inference lost.
          pricingMode: "FINAL_PRICE",
          externalBookingId: r.job.bookingId,
          // Stripe PaymentIntent from the CSV "Transaction id" column — keeps
          // the payment traceable (and refundable) from the job detail page.
          stripePaymentIntentId: r.job.transactionId,
          notes: r.job.notes,
          // Nested create, deliberately — NOT a separate createMany after the
          // insert. The dedupe branch above `continue`s BEFORE this create and
          // there is no update path, so rows land exactly once per created job.
          // A second write after the insert could lose its response, leaving a
          // job with no add-ons that every re-run then skips as a duplicate,
          // with no backfill path.
          //
          // price: 0 on every row — see resolveBkAddOns. The CSV's "Service
          // total" already includes these extras.
          ...(resolvedAddOns.rows.length
            ? { addOns: { create: resolvedAddOns.rows } }
            : {}),
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

  // ── 3b. flag add-ons that need pricing (commit only) ────────────────────────
  // ONE alert per run, with the names deduped — not one per row. A 205-row file
  // with a mismatched name on every row would otherwise raise 205 alerts across
  // four admin recipients.
  //
  // Known cost, stated so it isn't a surprise: the UI commits in batches of 50
  // and each batch is its own action call, so a large file raises roughly one
  // alert per batch, and the client's retry-once path can double one of them.
  if (commit && report.addOnsNeedingReview.length > 0) {
    const names = [...new Set(report.addOnsNeedingReview.map((a) => a.name))];
    await notifyAdmins({
      type: "GENERAL",
      severity: "WARNING",
      title: `${report.addOns.unmatched} imported add-on(s) need pricing`,
      message:
        `These BookingKoala add-on names had no match in Settings → Pricing → Add-Ons, ` +
        `so they were imported at $0.00 rather than dropped: ${names.join(", ")}. ` +
        `The imported job totals are unaffected — the CSV total already covered them.`,
      relatedType: "job",
    });
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
 * Half-open [start, end) instants of the BUSINESS-timezone calendar day that
 * contains `d`, plus a stable key for that day. Computed via startOfDayTz (not
 * +24h arithmetic) on both ends so DST transition days stay correct.
 */
function dayBounds(d: Date): { start: Date; end: Date; key: string } {
  const start = startOfDayTz(d);
  const end = startOfDayTz(new Date(start.getTime() + 36 * 60 * 60 * 1000));
  return { start, end, key: start.toISOString() };
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
