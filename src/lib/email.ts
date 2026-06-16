import { Resend } from "resend";
import { db } from "@/db";
import { isNotificationEnabled } from "@/lib/notifications";
import { coverFor } from "@/lib/gift-cards/covers";

/**
 * Identifies the catalog row that gates a given email send.
 * If admin has toggled this row's EMAIL channel off in
 * Settings → Notifications, `deliver()` skips the send.
 */
export interface NotificationGate {
  recipient: "ADMIN" | "CUSTOMER" | "PROVIDER";
  key: string;
}

const FROM = process.env.EMAIL_FROM ?? "Cleano <no-reply@cleano.ca>";

function getResend() {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY is not set — emails will be skipped");
    return null;
  }
  return new Resend(process.env.RESEND_API_KEY);
}

function fmt(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Shared layout ──────────────────────────────────────────────────────────

function layout(body: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f2ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07)">
<tr><td style="background:#00424a;padding:28px 32px">
<span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-.3px">Cleano</span>
</td></tr>
<tr><td style="padding:32px">${body}</td></tr>
<tr><td style="background:#f5f2ed;padding:20px 32px;font-size:12px;color:#888;text-align:center">
© ${new Date().getFullYear()} Cleano · care@cleano.ca
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function h1(text: string) {
  return `<h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#00424a">${text}</h1>`;
}
function p(text: string) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#333">${text}</p>`;
}
function section(rows: [string, string][]) {
  const inner = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;font-size:14px;color:#666;width:45%">${k}</td>
         <td style="padding:8px 0;font-size:14px;color:#111;font-weight:500;text-align:right">${v}</td></tr>`
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee;border-bottom:1px solid #eee;margin:20px 0">${inner}</table>`;
}
function btn(label: string, href: string) {
  return `<a href="${href}" style="display:inline-block;margin-top:8px;padding:12px 28px;background:#00424a;color:#fff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600">${label}</a>`;
}

// ── Send + log helper ──────────────────────────────────────────────────────

async function deliver(opts: {
  to: string;
  subject: string;
  html: string;
  logId?: string;
  notification?: NotificationGate;
  attachments?: Array<{ filename: string; content: Buffer | string }>;
}) {
  // Respect admin's notification toggles (Settings → Notifications).
  // If the EMAIL channel for this catalog row is off, we skip the send
  // and stamp the EmailLog so the admin can see we considered it.
  if (opts.notification) {
    const enabled = await isNotificationEnabled(
      opts.notification.recipient,
      opts.notification.key,
      "EMAIL"
    );
    if (!enabled) {
      if (opts.logId) {
        await db.emailLog
          .update({
            where: { id: opts.logId },
            data: { status: "FAILED", error: "Disabled in Settings → Notifications" },
          })
          .catch(() => {});
      }
      return { ok: false, skipped: true as const };
    }
  }
  const resend = getResend();
  if (!resend) {
    if (opts.logId) {
      await db.emailLog.update({
        where: { id: opts.logId },
        data: { status: "FAILED", error: "RESEND_API_KEY not configured" },
      }).catch(() => {});
    }
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.attachments && opts.attachments.length > 0
        ? { attachments: opts.attachments }
        : {}),
    });
    if (opts.logId) {
      if (error) {
        await db.emailLog.update({
          where: { id: opts.logId },
          data: { status: "FAILED", error: error.message },
        });
      } else {
        await db.emailLog.update({
          where: { id: opts.logId },
          data: { status: "SENT", sentAt: new Date(), providerId: data?.id },
        });
      }
    }
    return { ok: !error, error };
  } catch (err: any) {
    if (opts.logId) {
      await db.emailLog
        .update({
          where: { id: opts.logId },
          data: { status: "FAILED", error: String(err?.message ?? err) },
        })
        .catch(() => {});
    }
    return { ok: false, error: err };
  }
}

// ── Email senders ──────────────────────────────────────────────────────────

export async function sendBookingConfirmation(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  startTime: string;
  isFlexible: boolean;
  address: string;
  serviceType: string | null;
  subtotal: number | null;
  gst: number | null;
  qst: number | null;
  total: number | null;
  depositPaid?: boolean;
  logId?: string;
  /** When true, gate by `cust.booking.receipt_rec` instead of `_ot`. */
  recurring?: boolean;
}) {
  const timeLine = opts.isFlexible
    ? "Flexible — our team will confirm the time"
    : fmtTime(opts.startTime);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const sectionRows: [string, string][] = [
    ["Booking #", String(opts.jobNumber)],
    ["Date", fmtDate(opts.startTime)],
    ["Time", timeLine],
    ["Address", opts.address],
    ["Subtotal", fmt(opts.subtotal)],
    ["GST (5%)", fmt(opts.gst)],
    ["QST (9.975%)", fmt(opts.qst)],
    ["Total", fmt(opts.total)],
  ];
  if (opts.depositPaid) {
    sectionRows.push(["Deposit paid today", fmt(20)]);
  }

  const chargeNote = opts.depositPaid
    ? "A $20 deposit was collected at booking. The remaining balance is charged only after your cleaning is complete."
    : "Your card will be charged only after your cleaning is complete. You'll receive a receipt by email.";

  const html = layout(
    h1(`Booking confirmed, ${opts.clientName.split(" ")[0]}!`) +
      p(`We've got you down for a ${opts.serviceType ?? "cleaning"} on <strong>${fmtDate(opts.startTime)}</strong>.`) +
      section(sectionRows) +
      p(chargeNote) +
      btn("View this booking", `${appUrl}/portal/bookings/${opts.jobId}`) +
      btn("Manage all my bookings", `${appUrl}/portal/bookings`)
  );

  return deliver({
    to: opts.to,
    subject: `Cleano booking confirmed — ${fmtDate(opts.startTime)}`,
    html,
    logId: opts.logId,
    notification: {
      recipient: "CUSTOMER",
      key: opts.recurring ? "cust.booking.receipt_rec" : "cust.booking.receipt_ot",
    },
  });
}

export async function sendReminder24h(opts: {
  to: string;
  clientName: string;
  jobId: string;
  startTime: string;
  address: string;
  serviceType: string | null;
  cleanerNames: string[];
  logId?: string;
}) {
  const cleanerLine =
    opts.cleanerNames.length > 0
      ? `Your cleaner${opts.cleanerNames.length > 1 ? "s" : ""}: <strong>${opts.cleanerNames.join(", ")}</strong>`
      : "We're finalizing your cleaner assignment.";

  const html = layout(
    h1("Your cleaning is tomorrow!") +
      p(`Hi ${opts.clientName.split(" ")[0]}, just a friendly reminder about your ${opts.serviceType ?? "cleaning"} tomorrow.`) +
      section([
        ["Date", fmtDate(opts.startTime)],
        ["Time", fmtTime(opts.startTime)],
        ["Address", opts.address],
      ]) +
      p(cleanerLine) +
      p("Please ensure access to your home and any parking instructions are noted. See you tomorrow!") +
      btn("View this booking", `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/portal/bookings/${opts.jobId}`) +
      btn("Manage all my bookings", `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/portal/bookings`)
  );

  return deliver({
    to: opts.to,
    subject: `Reminder: your Cleano cleaning is tomorrow`,
    html,
    logId: opts.logId,
    notification: { recipient: "CUSTOMER", key: "cust.reminders.booking_reminder" },
  });
}

export async function sendReceipt(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  startTime: string;
  address: string;
  serviceType: string | null;
  subtotal: number | null;
  gst: number | null;
  qst: number | null;
  total: number | null;
  ratingToken?: string | null;
  logId?: string;
}) {
  const ratingSection = opts.ratingToken
    ? btn("Rate your cleaning", `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/rate/${opts.ratingToken}`)
    : "";

  const html = layout(
    h1("Payment received — thanks!") +
      p(`Hi ${opts.clientName.split(" ")[0]}, here's your receipt for job #${opts.jobNumber}.`) +
      section([
        ["Date", fmtDate(opts.startTime)],
        ["Service", opts.serviceType ?? "Cleaning"],
        ["Address", opts.address],
        ["Subtotal", fmt(opts.subtotal)],
        ["GST (5%)", fmt(opts.gst)],
        ["QST (9.975%)", fmt(opts.qst)],
        ["Total charged", fmt(opts.total)],
      ]) +
      p("You can also download a PDF receipt from your client portal.") +
      btn("Download receipt", `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/receipts/${opts.jobId}`) +
      btn("Manage all my bookings", `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/portal/bookings`) +
      (ratingSection ? `<div style="margin-top:24px">${p("How did we do? A quick rating helps our team a lot.")}</div>${ratingSection}` : "")
  );

  return deliver({
    to: opts.to,
    subject: `Cleano receipt — job #${opts.jobNumber}`,
    html,
    logId: opts.logId,
    notification: { recipient: "CUSTOMER", key: "cust.fee.service_receipt" },
  });
}

export async function sendRefundConfirmation(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  refundAmount: number;
  reason?: string | null;
  logId?: string;
}) {
  const html = layout(
    h1("Refund issued") +
      p(`Hi ${opts.clientName.split(" ")[0]}, we've issued a refund of <strong>${fmt(opts.refundAmount)}</strong> for job #${opts.jobNumber}.`) +
      (opts.reason ? p(`Reason: ${opts.reason}`) : "") +
      p("The amount will appear on your original payment method within 5–10 business days, depending on your bank.") +
      p("If you have any questions, reply to this email or text us at (514) 555-CLEAN.") +
      btn("View your bookings", `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/portal/bookings`)
  );

  return deliver({
    to: opts.to,
    subject: `Cleano refund — job #${opts.jobNumber}`,
    html,
    logId: opts.logId,
    notification: { recipient: "CUSTOMER", key: "cust.fee.refund_given" },
  });
}

/**
 * True if `now` is after 5 pm on the day before the booking start time.
 * Used to gate the spec's "after 5 pm" notification variants.
 */
function isAfter5pmDayBefore(startTime: Date, now: Date = new Date()): boolean {
  const dayBefore = new Date(startTime);
  dayBefore.setDate(dayBefore.getDate() - 1);
  dayBefore.setHours(17, 0, 0, 0);
  return now >= dayBefore && now < startTime;
}

async function fetchAdmins() {
  return db.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] } },
    select: { id: true, name: true, email: true },
  });
}

/**
 * Notify all admin/owner roles that a new booking just came in. Gated by
 * the `admin.booking.new` toggle in Settings → Notifications.
 */
export async function sendAdminNewBookingNotification(opts: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  startTime: string;
  isFlexible: boolean;
  address: string;
  serviceType: string | null;
  price: number | null;
  bookingSource: string | null;
  /** When true, gate by `admin.booking.new_via_referral` instead of `admin.booking.new`. */
  viaReferral?: boolean;
}) {
  const admins = await db.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] } },
    select: { id: true, name: true, email: true },
  });
  if (admins.length === 0) return;

  const timeLine = opts.isFlexible
    ? "Flexible — confirm time with customer"
    : fmtTime(opts.startTime);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const html = layout(
    h1(`New booking: ${opts.clientName}`) +
      p(`A ${opts.bookingSource === "web" ? "web" : "new"} booking just landed.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Customer", opts.clientName],
        ["Email", opts.clientEmail ?? "—"],
        ["Phone", opts.clientPhone ?? "—"],
        ["Date", fmtDate(opts.startTime)],
        ["Time", timeLine],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
        ["Total", fmt(opts.price)],
      ]) +
      btn("Open in admin", `${appUrl}/jobs/${opts.jobId}`)
  );

  const catalogKey = opts.viaReferral
    ? "admin.booking.new_via_referral"
    : "admin.booking.new";

  // One email per admin, each gated by the same toggle.
  for (const admin of admins) {
    try {
      await deliver({
        to: admin.email,
        subject: `New booking — ${opts.clientName} (#${opts.jobNumber})`,
        html,
        notification: { recipient: "ADMIN", key: catalogKey },
      });
    } catch (e) {
      console.error("sendAdminNewBookingNotification failed for", admin.email, e);
    }
  }
}

// ── Queue helpers (create log + send immediately) ──────────────────────────

export async function queueAndSendConfirmation(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      client: { select: { name: true, email: true } },
      cleaners: { select: { name: true } },
    },
  }) as any;
  if (!job?.client?.email) return;

  const existing = await db.emailLog.findFirst({
    where: { jobId, kind: "BOOKING_CONFIRMATION" },
    select: { id: true },
  });

  const log = existing
    ? await db.emailLog.update({ where: { id: existing.id }, data: { status: "PENDING" } })
    : await db.emailLog.create({
        data: {
          kind: "BOOKING_CONFIRMATION",
          recipient: job.client.email,
          subject: `Booking confirmed`,
          status: "PENDING",
          jobId,
        },
      });

  await sendBookingConfirmation({
    to: job.client.email,
    clientName: job.client.name,
    jobId: job.id,
    jobNumber: job.jobNumber,
    startTime: job.startTime.toISOString(),
    isFlexible: job.isFlexible,
    address: job.location ?? "",
    serviceType: job.jobType,
    subtotal: job.subtotalAmount,
    gst: job.gstAmount,
    qst: job.qstAmount,
    total: job.price,
    logId: log.id,
  });
}

export async function queueAndSendReceipt(jobId: string) {
  const [job, ratingToken] = await Promise.all([
    db.job.findUnique({
      where: { id: jobId },
      include: { client: { select: { name: true, email: true } } },
    }),
    db.jobRatingToken.findFirst({
      where: { jobId, usedAt: null },
      select: { token: true },
    }),
  ]);
  if (!(job as any)?.client?.email) return;
  const client = (job as any).client as { name: string; email: string };

  const log = await db.emailLog.create({
    data: {
      kind: "RECEIPT",
      recipient: client.email,
      subject: `Receipt for job #${job!.jobNumber}`,
      status: "PENDING",
      jobId,
    },
  });

  await sendReceipt({
    to: client.email,
    clientName: client.name,
    jobId: job!.id,
    jobNumber: job!.jobNumber,
    startTime: job!.startTime.toISOString(),
    address: job!.location ?? "",
    serviceType: job!.jobType,
    subtotal: job!.subtotalAmount,
    gst: job!.gstAmount,
    qst: job!.qstAmount,
    total: job!.price,
    ratingToken: ratingToken?.token ?? null,
    logId: log.id,
  });
}

export async function queueAndSendRefund(jobId: string, refundAmount: number, reason?: string | null) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { client: { select: { name: true, email: true } } },
  }) as any;
  if (!job?.client?.email) return;

  const log = await db.emailLog.create({
    data: {
      kind: "REFUND",
      recipient: job.client.email,
      subject: `Refund for job #${job.jobNumber}`,
      status: "PENDING",
      jobId,
    },
  });

  await sendRefundConfirmation({
    to: job.client.email,
    clientName: job.client.name,
    jobId: job.id,
    jobNumber: job.jobNumber,
    refundAmount,
    reason,
    logId: log.id,
  });
}

// ──────────────────────────────────────────────────────────────────────
// BOOKING LIFECYCLE — admin + customer notifications
// All senders are gated by their catalog row in Settings → Notifications.
// "After 5 pm the day before service" rules use isAfter5pmDayBefore.
// ──────────────────────────────────────────────────────────────────────

interface LifecycleJobInfo {
  jobId: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
  address: string;
  serviceType: string | null;
}

/** Admin email when a booking is edited. Picks `_after_5pm` variant if applicable. */
export async function sendAdminBookingModified(opts: LifecycleJobInfo & {
  changedBy: string;
  changesSummary?: string;
}) {
  const after5 = isAfter5pmDayBefore(new Date(opts.startTime));
  const key = after5 ? "admin.booking.modified_after_5pm" : "admin.booking.modified";
  const subject = after5
    ? `Late edit (after 5 pm) — ${opts.clientName} (#${opts.jobNumber})`
    : `Booking modified — ${opts.clientName} (#${opts.jobNumber})`;

  const admins = await fetchAdmins();
  if (admins.length === 0) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(after5 ? "Late booking change" : "Booking updated") +
      p(`${opts.changedBy} updated job #${opts.jobNumber} for <strong>${opts.clientName}</strong>.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Customer", opts.clientName],
        ["Date", fmtDate(opts.startTime)],
        ["Time", fmtTime(opts.startTime)],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
      ]) +
      (opts.changesSummary ? p(`<em>${opts.changesSummary}</em>`) : "") +
      btn("Open in admin", `${appUrl}/jobs/${opts.jobId}`)
  );

  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject,
      html,
      notification: { recipient: "ADMIN", key },
    }).catch((e) => console.error("sendAdminBookingModified", admin.email, e));
  }
}

/** Admin email when a booking is canceled. Picks `_after_5pm` variant if applicable. */
export async function sendAdminBookingCanceled(opts: LifecycleJobInfo & {
  reason?: string | null;
  canceledBy: string;
}) {
  const after5 = isAfter5pmDayBefore(new Date(opts.startTime));
  const key = after5 ? "admin.cancel.booking_canceled_after_5pm" : "admin.cancel.booking_canceled";
  const subject = after5
    ? `Late cancel (after 5 pm) — ${opts.clientName} (#${opts.jobNumber})`
    : `Booking canceled — ${opts.clientName} (#${opts.jobNumber})`;

  const admins = await fetchAdmins();
  if (admins.length === 0) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(after5 ? "Late cancellation" : "Booking canceled") +
      p(`${opts.canceledBy} canceled job #${opts.jobNumber} for <strong>${opts.clientName}</strong>.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Customer", opts.clientName],
        ["Was scheduled", `${fmtDate(opts.startTime)} at ${fmtTime(opts.startTime)}`],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
      ]) +
      (opts.reason ? p(`<strong>Reason:</strong> ${opts.reason}`) : "") +
      btn("Open in admin", `${appUrl}/jobs/${opts.jobId}`)
  );

  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject,
      html,
      notification: { recipient: "ADMIN", key },
    }).catch((e) => console.error("sendAdminBookingCanceled", admin.email, e));
  }
}

/** Admin email when a customer submits a cancellation request via the portal. */
export async function sendAdminBookingCancellationRequest(opts: LifecycleJobInfo) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const html = layout(
    h1("Cancellation requested") +
      p(`<strong>${opts.clientName}</strong> requested to cancel job #${opts.jobNumber}.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Customer", opts.clientName],
        ["Scheduled", `${fmtDate(opts.startTime)} at ${fmtTime(opts.startTime)}`],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
      ]) +
      p("Review the request and either approve the cancellation or contact the customer.") +
      btn("Open in admin", `${appUrl}/jobs/${opts.jobId}`)
  );

  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Cancellation requested — ${opts.clientName} (#${opts.jobNumber})`,
      html,
      notification: { recipient: "ADMIN", key: "admin.cancel.booking_cancellation_request" },
    }).catch((e) => console.error("sendAdminBookingCancellationRequest", admin.email, e));
  }
}

/** Admin email when a customer postpones / requests a reschedule via the portal. */
export async function sendAdminBookingPostpone(opts: LifecycleJobInfo) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const html = layout(
    h1("Booking postponed by customer") +
      p(`<strong>${opts.clientName}</strong> requested to postpone job #${opts.jobNumber}.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Customer", opts.clientName],
        ["Was scheduled", `${fmtDate(opts.startTime)} at ${fmtTime(opts.startTime)}`],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
      ]) +
      p("Get in touch with the customer to confirm a new time.") +
      btn("Open in admin", `${appUrl}/jobs/${opts.jobId}`)
  );

  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Postpone request — ${opts.clientName} (#${opts.jobNumber})`,
      html,
      notification: { recipient: "ADMIN", key: "admin.cancel.postpone_booking" },
    }).catch((e) => console.error("sendAdminBookingPostpone", admin.email, e));
  }
}

/** Customer email when their booking is confirmed (provider paired). */
export async function sendCustomerBookingConfirmed(opts: LifecycleJobInfo & {
  to: string;
  cleanerNames: string[];
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Your cleaner is confirmed`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, great news — your booking is fully set.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Date", fmtDate(opts.startTime)],
        ["Time", fmtTime(opts.startTime)],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
        ["Your cleaner" + (opts.cleanerNames.length > 1 ? "s" : ""), opts.cleanerNames.join(", ") || "—"],
      ]) +
      btn("View this booking", `${appUrl}/portal/bookings/${opts.jobId}`)
  );

  return deliver({
    to: opts.to,
    subject: `Cleaner confirmed for your Cleano booking #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.booking.confirmed" },
  });
}

/** Customer email when their booking is modified by admin. */
export async function sendCustomerBookingModified(opts: LifecycleJobInfo & {
  to: string;
  changesSummary?: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Your booking was updated`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, we've made a change to your upcoming cleaning.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Date", fmtDate(opts.startTime)],
        ["Time", fmtTime(opts.startTime)],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
      ]) +
      (opts.changesSummary ? p(`<em>${opts.changesSummary}</em>`) : "") +
      p("If anything looks off, just reply to this email and we'll sort it out.") +
      btn("View this booking", `${appUrl}/portal/bookings/${opts.jobId}`)
  );

  return deliver({
    to: opts.to,
    subject: `Cleano booking updated — #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.booking.modified" },
  });
}

/** Customer email when their booking is canceled. */
export async function sendCustomerBookingCancellation(opts: LifecycleJobInfo & {
  to: string;
  reason?: string | null;
  refundIssued?: boolean;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Your booking was canceled`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, your Cleano booking has been canceled.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Was scheduled", `${fmtDate(opts.startTime)} at ${fmtTime(opts.startTime)}`],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
      ]) +
      (opts.reason ? p(`<strong>Reason:</strong> ${opts.reason}`) : "") +
      (opts.refundIssued
        ? p("A refund has been issued and will appear on your card within 5–10 business days.")
        : p("If you have any questions, just reply to this email.")) +
      btn("Book another cleaning", `${appUrl}/book`)
  );

  return deliver({
    to: opts.to,
    subject: `Cleano booking canceled — #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.cancel.booking_cancellation" },
  });
}

// ──────────────────────────────────────────────────────────────────────
// PAYMENTS + REFUNDS lifecycle (Batch 2)
// ──────────────────────────────────────────────────────────────────────

/** Customer email when the booking total is charged (Stripe-confirmed or manual). */
export async function sendCustomerBookingCharged(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  amount: number;
  paymentMethod?: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("Payment received") +
      p(`Hi ${opts.clientName.split(" ")[0]}, we've received your payment for job #${opts.jobNumber}.`) +
      section([
        ["Amount", fmt(opts.amount)],
        ["Paid by", opts.paymentMethod ?? "Card on file"],
      ]) +
      p("Your itemized receipt will follow shortly.") +
      btn("View booking", `${appUrl}/portal/bookings/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `Cleano payment received — #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.fee.booking_charged" },
  });
}

/** Customer email when an extra fee (tip / cancellation / extra) is charged on top of a booking. */
export async function sendCustomerFeesCharged(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  feeType: "tip" | "cancellation" | "extra" | "reschedule";
  amount: number;
}) {
  const labelMap = {
    tip: "Tip charged",
    cancellation: "Cancellation fee charged",
    extra: "Extra charge",
    reschedule: "Reschedule fee charged",
  } as const;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(labelMap[opts.feeType]) +
      p(
        `Hi ${opts.clientName.split(" ")[0]}, we charged ${fmt(opts.amount)} to your card on file for job #${opts.jobNumber}.`
      ) +
      section([
        ["Type", labelMap[opts.feeType]],
        ["Amount", fmt(opts.amount)],
      ]) +
      btn("View booking", `${appUrl}/portal/bookings/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `${labelMap[opts.feeType]} — #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.fee.fees_charged" },
  });
}

/** Customer email when a booking deposit / pre-payment is charged. */
export async function sendCustomerBookingsPrepaid(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  amount: number;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("Deposit received") +
      p(`Hi ${opts.clientName.split(" ")[0]}, we collected your ${fmt(opts.amount)} deposit for booking #${opts.jobNumber}.`) +
      p("The balance will be charged after your cleaning is complete.") +
      btn("View booking", `${appUrl}/portal/bookings/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `Cleano deposit received — #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.fee.bookings_prepaid" },
  });
}

/** Customer email when their card is declined. */
export async function sendCustomerCardDeclined(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  reason: string;
  context: "charge" | "hold" | "modified_hold_failed";
}) {
  const keyMap = {
    charge: "cust.card.declined",
    hold: "cust.card.declined_on_hold",
    modified_hold_failed: "cust.card.modified_hold_failed",
  } as const;
  const labelMap = {
    charge: "Card declined",
    hold: "Card declined during hold",
    modified_hold_failed: "Card hold failed for booking change",
  };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const html = layout(
    h1(labelMap[opts.context]) +
      p(`Hi ${opts.clientName.split(" ")[0]}, we weren't able to process your card for booking #${opts.jobNumber}.`) +
      p(`<strong>Reason from your bank:</strong> ${opts.reason}`) +
      p("Please update your card details in the portal — we'll retry once it's saved.") +
      btn("Update card", `${appUrl}/portal/bookings/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `Cleano card declined — #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: keyMap[opts.context] },
  });
}

/** Admin email when a customer card is declined. Context picks the catalog key. */
export async function sendAdminCardDeclined(opts: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  reason: string;
  amountAttempted?: number;
  context: "charge" | "hold" | "modified_hold_failed";
}) {
  const keyMap = {
    charge: "admin.card.declined",
    hold: "admin.card.declined_on_hold",
    modified_hold_failed: "admin.card.modified_hold_failed",
  } as const;

  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Card declined — ${opts.clientName}`) +
      p(`The customer's card was declined while attempting to process job #${opts.jobNumber}.`) +
      section([
        ["Customer", opts.clientName],
        ["Booking #", String(opts.jobNumber)],
        ["Amount", opts.amountAttempted ? fmt(opts.amountAttempted) : "—"],
        ["Reason", opts.reason],
      ]) +
      btn("Open in admin", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Card declined — ${opts.clientName} (#${opts.jobNumber})`,
      html,
      notification: { recipient: "ADMIN", key: keyMap[opts.context] },
    }).catch((e) => console.error("sendAdminCardDeclined", admin.email, e));
  }
}

/** Admin email when a customer adds a new card on file. */
export async function sendAdminNewCardAdded(opts: {
  clientName: string;
  clientEmail: string;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const html = layout(
    h1("New card added") +
      p(`<strong>${opts.clientName}</strong> (${opts.clientEmail}) added a new card to their profile.`) +
      p("They'll be billed on the new card going forward.")
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `New card on file — ${opts.clientName}`,
      html,
      notification: { recipient: "ADMIN", key: "admin.card.new_card_added" },
    }).catch((e) => console.error("sendAdminNewCardAdded", admin.email, e));
  }
}

/** Admin email when a tip is recorded post-booking. */
export async function sendAdminTipReceived(opts: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  tipAmount: number;
  cleanerNames?: string[];
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Tip received — ${fmt(opts.tipAmount)}`) +
      p(`<strong>${opts.clientName}</strong> tipped ${fmt(opts.tipAmount)} on job #${opts.jobNumber}.`) +
      (opts.cleanerNames && opts.cleanerNames.length > 0
        ? p(`Goes to: ${opts.cleanerNames.join(", ")}`)
        : "") +
      btn("Open in admin", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Tip received — ${opts.clientName} (#${opts.jobNumber})`,
      html,
      notification: { recipient: "ADMIN", key: "admin.fee.tip_received" },
    }).catch((e) => console.error("sendAdminTipReceived", admin.email, e));
  }
}

// ──────────────────────────────────────────────────────────────────────
// RATING + REVIEW + CLOCK + CHECKLIST (Sub-batch 3A)
// ──────────────────────────────────────────────────────────────────────

/** Customer "Rate us" email — sent post-job with the rating-token link. */
export async function sendCustomerRateUs(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  ratingToken: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`How did we do?`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, your cleaning is done — would you mind sharing how it went? It takes 10 seconds and helps our team a lot.`) +
      btn("Rate your cleaning", `${appUrl}/rate/${opts.ratingToken}`) +
      p(`<small>If the button doesn't work, paste this link in your browser: ${appUrl}/rate/${opts.ratingToken}</small>`)
  );
  return deliver({
    to: opts.to,
    subject: `Rate your Cleano cleaning — job #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.rating.rate_us" },
  });
}

/**
 * Customer email triggered when they leave a 1-star rating. Promises a
 * follow-up from our ops team. Paired with a CRITICAL admin alert that
 * surfaces in the alerts inbox so ops can reach out with compensation.
 */
export async function sendCustomerPoorRatingFollowUp(opts: {
  to: string;
  clientName: string;
  jobNumber: number;
}) {
  const html = layout(
    h1(`We want to make this right`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, thank you for sharing your honest feedback on booking #${opts.jobNumber}. A representative from our team will reach out to you shortly to resolve your issue and make it right.`) +
      p(`You don't need to do anything in the meantime — we'll be in touch by email or phone within one business day.`)
  );
  return deliver({
    to: opts.to,
    subject: `We want to make this right — booking #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.rating.poor" },
  });
}

/** Admin emails when a new review is left. Picks `poor` or `overall_dropped` variants when applicable. */
export async function sendAdminNewReview(opts: {
  jobId: string | null;
  jobNumber: number | null;
  employeeName: string;
  rating: number;
  notes?: string | null;
  overallRating?: number | null; // post-recalc rating, used for `overall_dropped`
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const isPoor = opts.rating <= 3;
  const overallDropped =
    typeof opts.overallRating === "number" && opts.overallRating < 4;

  const body =
    h1(`${opts.rating}/5 review for ${opts.employeeName}${isPoor ? " ⚠️" : ""}`) +
    p(opts.jobNumber ? `Left for job #${opts.jobNumber}.` : "Manual rating entry.") +
    section([
      ["Cleaner", opts.employeeName],
      ["Rating", `${opts.rating}/5`],
      ["Overall after recalc", typeof opts.overallRating === "number" ? `${opts.overallRating.toFixed(2)}/5` : "—"],
    ]) +
    (opts.notes ? p(`<strong>Notes:</strong> ${opts.notes}`) : "") +
    (opts.jobId ? btn("Open job", `${appUrl}/jobs/${opts.jobId}`) : "");

  const html = layout(body);

  // Always send `admin.rating.new`; additionally `admin.rating.poor` for ≤3,
  // and `admin.rating.overall_dropped` when the post-recalc rating slipped <4.
  const keys: string[] = ["admin.rating.new"];
  if (isPoor) keys.push("admin.rating.poor");
  if (overallDropped) keys.push("admin.rating.overall_dropped");

  for (const admin of admins) {
    for (const key of keys) {
      await deliver({
        to: admin.email,
        subject: `${opts.rating}/5 review — ${opts.employeeName}`,
        html,
        notification: { recipient: "ADMIN", key },
      }).catch((e) => console.error("sendAdminNewReview", admin.email, key, e));
    }
  }
}

/** Provider email when they get a new review. */
export async function sendProviderNewReview(opts: {
  to: string;
  employeeName: string;
  jobId: string | null;
  jobNumber: number | null;
  rating: number;
  notes?: string | null;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`You got a ${opts.rating}/5 review`) +
      p(`Hi ${opts.employeeName.split(" ")[0]}, you received a new rating.`) +
      section([
        ["Rating", `${opts.rating}/5 ⭐`],
        ["Job", opts.jobNumber ? `#${opts.jobNumber}` : "—"],
      ]) +
      (opts.notes ? p(`<strong>What the customer said:</strong> ${opts.notes}`) : "") +
      (opts.jobId ? btn("Open job", `${appUrl}/my-jobs/${opts.jobId}`) : "")
  );
  return deliver({
    to: opts.to,
    subject: `${opts.rating}/5 review on your Cleano work`,
    html,
    notification: { recipient: "PROVIDER", key: "prov.rating.new_review" },
  });
}

/** Admin email when a cleaner clocks in. */
export async function sendAdminClockedIn(opts: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  cleanerName: string;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`${opts.cleanerName} clocked in`) +
      p(`Job #${opts.jobNumber} for <strong>${opts.clientName}</strong> just started.`) +
      btn("Open job", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Clocked in — ${opts.cleanerName} on #${opts.jobNumber}`,
      html,
      notification: { recipient: "ADMIN", key: "admin.clock.clocked_in" },
    }).catch((e) => console.error("sendAdminClockedIn", admin.email, e));
  }
}

/** Admin email when a cleaner clocks out. */
export async function sendAdminClockedOut(opts: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  cleanerName: string;
  durationMinutes: number;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`${opts.cleanerName} clocked out`) +
      p(`Job #${opts.jobNumber} for <strong>${opts.clientName}</strong> is done.`) +
      section([
        ["Duration", `${opts.durationMinutes} min`],
      ]) +
      btn("Open job", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Clocked out — ${opts.cleanerName} on #${opts.jobNumber}`,
      html,
      notification: { recipient: "ADMIN", key: "admin.clock.clocked_out" },
    }).catch((e) => console.error("sendAdminClockedOut", admin.email, e));
  }
}

/** Admin email when a job checklist is fully completed. */
export async function sendAdminChecklistCompleted(opts: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  cleanerName: string;
  itemCount: number;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Checklist complete — ${opts.clientName}`) +
      p(`<strong>${opts.cleanerName}</strong> just finished every checklist item on job #${opts.jobNumber}.`) +
      section([
        ["Items completed", `${opts.itemCount}/${opts.itemCount}`],
      ]) +
      btn("Open job", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Checklist done — #${opts.jobNumber}`,
      html,
      notification: { recipient: "ADMIN", key: "admin.checklist.completed" },
    }).catch((e) => console.error("sendAdminChecklistCompleted", admin.email, e));
  }
}

// ──────────────────────────────────────────────────────────────────────
// ACCOUNT LIFECYCLE — customer + provider variants in one place.
// Use sendAccountEmail(...) with the right `event` + `role`.
// ──────────────────────────────────────────────────────────────────────

type AccountEvent =
  | "new_account"
  | "setup_password"
  | "reset_password"
  | "password_changed"
  | "profile_changed"
  | "activated"
  | "deactivated"
  | "add_card"
  | "how_it_works"
  | "email_verification"
  | "signup_submitted"
  | "signup_rejected";

interface AccountEmailOpts {
  to: string;
  name: string;
  role: "CUSTOMER" | "PROVIDER";
  event: AccountEvent;
  /** Reset / verify / setup URL when applicable. */
  link?: string;
}

const ACCOUNT_KEY_MAP: Record<
  "CUSTOMER" | "PROVIDER",
  Partial<Record<AccountEvent, string>>
> = {
  CUSTOMER: {
    new_account: "cust.account.new",
    setup_password: "cust.account.setup_password",
    reset_password: "cust.account.reset_password",
    password_changed: "cust.account.password_changed",
    profile_changed: "cust.account.profile_changed",
    activated: "cust.account.activated",
    deactivated: "cust.account.deactivated",
    add_card: "cust.account.add_card",
  },
  PROVIDER: {
    new_account: "prov.account.new",
    how_it_works: "prov.account.how_it_works",
    reset_password: "prov.account.reset_password",
    password_changed: "prov.account.password_changed",
    activated: "prov.account.activated",
    deactivated: "prov.account.deactivated",
    email_verification: "prov.account.email_verification",
    signup_submitted: "prov.account.signup_submitted",
    signup_rejected: "prov.account.signup_rejected",
  },
};

const ACCOUNT_COPY: Record<AccountEvent, { subject: string; title: string; body: (name: string, link?: string) => string }> = {
  new_account: {
    subject: "Welcome to Cleano",
    title: "Welcome to Cleano",
    body: (n) => `Hi ${n.split(" ")[0]}, thanks for joining Cleano. We're glad to have you.`,
  },
  setup_password: {
    subject: "Set up your Cleano password",
    title: "Set your password",
    body: (n, l) => `Hi ${n.split(" ")[0]}, set your password to finish creating your Cleano account.${l ? ` <a href="${l}">Set my password</a>` : ""}`,
  },
  reset_password: {
    subject: "Reset your Cleano password",
    title: "Password reset",
    body: (n, l) => `Hi ${n.split(" ")[0]}, click the link below to choose a new password. It expires in 1 hour.${l ? ` <a href="${l}">Reset my password</a>` : ""}`,
  },
  password_changed: {
    subject: "Your Cleano password was changed",
    title: "Password updated",
    body: (n) => `Hi ${n.split(" ")[0]}, your password was just changed. If this wasn't you, please contact us right away.`,
  },
  profile_changed: {
    subject: "Your Cleano profile was updated",
    title: "Profile updated",
    body: (n) => `Hi ${n.split(" ")[0]}, your profile information was just updated. If this wasn't you, please get in touch.`,
  },
  activated: {
    subject: "Your Cleano account is active",
    title: "Account activated",
    body: (n) => `Hi ${n.split(" ")[0]}, your Cleano account is active and ready to use.`,
  },
  deactivated: {
    subject: "Your Cleano account was deactivated",
    title: "Account deactivated",
    body: (n) => `Hi ${n.split(" ")[0]}, your Cleano account has been deactivated. Reach out if you have any questions.`,
  },
  add_card: {
    subject: "Add a card to your Cleano account",
    title: "Add a payment method",
    body: (n, l) => `Hi ${n.split(" ")[0]}, please add a card to your profile to complete the booking flow.${l ? ` <a href="${l}">Add card</a>` : ""}`,
  },
  how_it_works: {
    subject: "How Cleano works",
    title: "Quick tour",
    body: (n) =>
      `Hi ${n.split(" ")[0]}, here's the rundown:<br><br>` +
      `<strong>1.</strong> Browse the Available jobs tab and accept ones that fit your schedule.<br>` +
      `<strong>2.</strong> Clock in when you arrive, complete the checklist, clock out when done.<br>` +
      `<strong>3.</strong> Payments and wash credits land in your account automatically.<br><br>` +
      `Reach out anytime via the Messages tab — admin is one tap away.`,
  },
  email_verification: {
    subject: "Verify your Cleano email",
    title: "Verify your email",
    body: (n, l) => `Hi ${n.split(" ")[0]}, click the link below to verify your email and continue onboarding.${l ? ` <a href="${l}">Verify email</a>` : ""}`,
  },
  signup_submitted: {
    subject: "We received your Cleano application",
    title: "Application received",
    body: (n) => `Hi ${n.split(" ")[0]}, thanks for applying to join Cleano. We'll review and get back to you within 2–3 business days.`,
  },
  signup_rejected: {
    subject: "Update on your Cleano application",
    title: "Application update",
    body: (n) => `Hi ${n.split(" ")[0]}, after reviewing your application we're not able to move forward at this time. We appreciate your interest in Cleano.`,
  },
};

export async function sendAccountEmail(opts: AccountEmailOpts) {
  const key = ACCOUNT_KEY_MAP[opts.role][opts.event];
  if (!key) return { ok: false, error: "Unknown event for role" };
  const copy = ACCOUNT_COPY[opts.event];
  const html = layout(h1(copy.title) + p(copy.body(opts.name, opts.link)));
  return deliver({
    to: opts.to,
    subject: copy.subject,
    html,
    notification: { recipient: opts.role, key },
  });
}

// ──────────────────────────────────────────────────────────────────────
// INVOICE LIFECYCLE
// ──────────────────────────────────────────────────────────────────────

type InvoiceEvent =
  | "new"
  | "update"
  | "resend"
  | "partial_charge"
  | "charge"
  | "card_declined"
  | "skip"
  | "end_recurring"
  | "custom_refund"
  | "charge_auth"
  | "contract_otp";

interface InvoiceEmailOpts {
  to: string;
  recipient: "ADMIN" | "CUSTOMER";
  event: InvoiceEvent;
  invoiceNumber: number | string;
  amount?: number;
  link?: string;
  clientName?: string;
  /** Optional PDF attachment — usually the invoice PDF for `new`/`update`/`resend`. */
  pdfAttachment?: { filename: string; content: Buffer };
}

const INVOICE_KEY_MAP: Record<"ADMIN" | "CUSTOMER", Partial<Record<InvoiceEvent, string>>> = {
  ADMIN: {
    partial_charge: "admin.invoice.partial_charge",
    charge: "admin.invoice.charge",
    card_declined: "admin.invoice.card_declined",
    skip: "admin.invoice.skip",
    end_recurring: "admin.invoice.end_recurring",
  },
  CUSTOMER: {
    new: "cust.invoice.new",
    update: "cust.invoice.update",
    resend: "cust.invoice.resend",
    partial_charge: "cust.invoice.partial_charge",
    charge: "cust.invoice.charge",
    card_declined: "cust.invoice.card_declined",
    custom_refund: "cust.invoice.custom_refund",
    charge_auth: "cust.invoice.charge_auth",
    contract_otp: "cust.invoice.contract_otp",
  },
};

const INVOICE_COPY: Record<InvoiceEvent, { subject: (n: string | number) => string; title: string; body: (opts: InvoiceEmailOpts) => string }> = {
  new: {
    subject: (n) => `New Cleano invoice #${n}`,
    title: "New invoice",
    body: (o) => `Hi ${(o.clientName ?? "there").split(" ")[0]}, a new invoice has been generated${o.amount ? ` for ${fmt(o.amount)}` : ""}.${o.link ? ` <a href="${o.link}">View invoice</a>` : ""}`,
  },
  update: {
    subject: (n) => `Invoice #${n} updated`,
    title: "Invoice updated",
    body: (o) => `Hi ${(o.clientName ?? "there").split(" ")[0]}, your invoice was updated.${o.link ? ` <a href="${o.link}">View invoice</a>` : ""}`,
  },
  resend: {
    subject: (n) => `Invoice #${n} (resent)`,
    title: "Invoice resent",
    body: (o) => `Hi ${(o.clientName ?? "there").split(" ")[0]}, resending your invoice as requested.${o.link ? ` <a href="${o.link}">View invoice</a>` : ""}`,
  },
  partial_charge: {
    subject: (n) => `Invoice #${n} — partial payment`,
    title: "Partial payment received",
    body: (o) => `${o.amount ? fmt(o.amount) : "Part of the invoice"} has been charged.`,
  },
  charge: {
    subject: (n) => `Invoice #${n} — paid`,
    title: "Invoice paid",
    body: (o) => `Invoice paid in full${o.amount ? ` (${fmt(o.amount)})` : ""}.`,
  },
  card_declined: {
    subject: (n) => `Invoice #${n} — card declined`,
    title: "Card declined",
    body: () => `The card on file was declined while charging this invoice. Please retry or update payment details.`,
  },
  skip: {
    subject: (n) => `Invoice #${n} skipped`,
    title: "Invoice skipped",
    body: () => `This invoice was skipped because no valid booking was found to bill.`,
  },
  end_recurring: {
    subject: () => `Recurring invoice ended`,
    title: "Recurring schedule ended",
    body: () => `The recurring invoice schedule has ended (no upcoming bookings).`,
  },
  custom_refund: {
    subject: (n) => `Invoice #${n} — refund issued`,
    title: "Refund issued",
    body: (o) => `${o.amount ? fmt(o.amount) : "An amount"} has been refunded for this invoice.`,
  },
  charge_auth: {
    subject: (n) => `Invoice #${n} — authentication needed`,
    title: "Confirm your card",
    body: (o) => `Your bank needs you to confirm this charge. ${o.link ? `<a href="${o.link}">Confirm payment</a>` : ""}`,
  },
  contract_otp: {
    subject: () => `Your Cleano contract code`,
    title: "Verification code",
    body: (o) => `Your one-time code: <strong>${o.amount ?? "—"}</strong>`,
  },
};

export async function sendInvoiceEmail(opts: InvoiceEmailOpts) {
  const key = INVOICE_KEY_MAP[opts.recipient][opts.event];
  if (!key) return { ok: false, error: "Unknown invoice event for recipient" };
  const copy = INVOICE_COPY[opts.event];
  const html = layout(h1(copy.title) + p(copy.body(opts)));
  return deliver({
    to: opts.to,
    subject: copy.subject(opts.invoiceNumber),
    html,
    notification: { recipient: opts.recipient, key },
    ...(opts.pdfAttachment
      ? { attachments: [opts.pdfAttachment] }
      : {}),
  });
}

// ──────────────────────────────────────────────────────────────────────
// DOCUMENTS + UNASSIGNED + SCHEDULE
// ──────────────────────────────────────────────────────────────────────

export async function sendProviderDocumentUploaded(opts: {
  to: string;
  providerName: string;
  documentTitle: string;
}) {
  const html = layout(
    h1("New document on your Cleano drive") +
      p(`Hi ${opts.providerName.split(" ")[0]}, <strong>${opts.documentTitle}</strong> was added to your drive.`)
  );
  return deliver({
    to: opts.to,
    subject: `New document: ${opts.documentTitle}`,
    html,
    notification: { recipient: "PROVIDER", key: "prov.drive.doc_uploaded" },
  });
}

export async function sendAdminDocSignatureRequest(opts: {
  signerName: string;
  documentTitle: string;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const html = layout(
    h1("New document needs a signature") +
      p(`<strong>${opts.signerName}</strong> needs to sign <strong>${opts.documentTitle}</strong>.`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Signature requested — ${opts.documentTitle}`,
      html,
      notification: { recipient: "ADMIN", key: "admin.docs.signature_request" },
    }).catch((e) => console.error("admin signature-request", admin.email, e));
  }
}

export async function sendAdminDocSigned(opts: {
  signerName: string;
  documentTitle: string;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const html = layout(
    h1("Document signed") +
      p(`<strong>${opts.signerName}</strong> signed <strong>${opts.documentTitle}</strong>.`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Signed: ${opts.documentTitle}`,
      html,
      notification: { recipient: "ADMIN", key: "admin.docs.signed_completed" },
    }).catch((e) => console.error("admin signed-completed", admin.email, e));
  }
}

type UnassignedEvent = "new" | "moved" | "modified" | "grabbed";
const UNASSIGNED_KEY_MAP: Record<UnassignedEvent, string> = {
  new: "admin.unassigned.new",
  moved: "admin.unassigned.moved",
  modified: "admin.unassigned.modified",
  grabbed: "admin.unassigned.grabbed",
};
const UNASSIGNED_LABEL: Record<UnassignedEvent, string> = {
  new: "New booking in unassigned folder",
  moved: "Booking moved to unassigned folder",
  modified: "Unassigned booking modified",
  grabbed: "Someone grabbed an unassigned job",
};

export async function sendAdminUnassignedEvent(opts: {
  event: UnassignedEvent;
  jobId: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(UNASSIGNED_LABEL[opts.event]) +
      p(`Job #${opts.jobNumber} for <strong>${opts.clientName}</strong>${opts.event === "new" || opts.event === "moved" ? " is currently unassigned." : "."}`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Customer", opts.clientName],
        ["Date", fmtDate(opts.startTime)],
        ["Time", fmtTime(opts.startTime)],
      ]) +
      btn("Open in admin", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `${UNASSIGNED_LABEL[opts.event]} — ${opts.clientName} (#${opts.jobNumber})`,
      html,
      notification: { recipient: "ADMIN", key: UNASSIGNED_KEY_MAP[opts.event] },
    }).catch((e) => console.error("admin unassigned", admin.email, opts.event, e));
  }
}

export async function sendAdminScheduleSettingsEvent(opts: {
  event: "settings_mod_request" | "schedule_mod_request" | "schedule_updated" | "settings_updated";
  providerName: string;
  detail?: string;
}) {
  const keyMap = {
    settings_mod_request: "admin.schedule.settings_modification_request",
    schedule_mod_request: "admin.schedule.schedule_modification_request",
    schedule_updated: "admin.schedule.schedule_updated",
    settings_updated: "admin.schedule.settings_updated",
  } as const;
  const labelMap = {
    settings_mod_request: "Settings modification request",
    schedule_mod_request: "Schedule modification request",
    schedule_updated: "Schedule updated",
    settings_updated: "Settings updated",
  } as const;
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const html = layout(
    h1(`${opts.providerName}: ${labelMap[opts.event]}`) +
      (opts.detail ? p(opts.detail) : "")
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `${labelMap[opts.event]} — ${opts.providerName}`,
      html,
      notification: { recipient: "ADMIN", key: keyMap[opts.event] },
    }).catch((e) => console.error("admin schedule-event", admin.email, opts.event, e));
  }
}

export async function sendProviderScheduleResponse(opts: {
  to: string;
  providerName: string;
  approved: boolean;
  detail?: string;
  scope: "schedule" | "settings";
}) {
  const keyMap = {
    schedule: "prov.schedule.modification_response",
    settings: opts.approved ? "prov.schedule.settings_approved" : "prov.schedule.settings_declined",
  } as const;
  const titleMap = {
    schedule: opts.approved ? "Your schedule change was approved" : "Your schedule change was declined",
    settings: opts.approved ? "Your settings change was approved" : "Your settings change was declined",
  } as const;
  const html = layout(
    h1(titleMap[opts.scope]) +
      p(`Hi ${opts.providerName.split(" ")[0]}, ${opts.approved ? "your request was approved." : "your request was declined."}`) +
      (opts.detail ? p(opts.detail) : "")
  );
  return deliver({
    to: opts.to,
    subject: titleMap[opts.scope],
    html,
    notification: { recipient: "PROVIDER", key: keyMap[opts.scope] },
  });
}

export async function sendAdminSignupReview(opts: {
  applicantName: string;
  applicantEmail: string;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("New cleaner sign-up to review") +
      p(`<strong>${opts.applicantName}</strong> (${opts.applicantEmail}) signed up. Approve or reject from the admin.`) +
      btn("Open admin", `${appUrl}/requests`)
  );
  // Fire two catalog rows — `admin.signup.new_provider` (informational) AND
  // `admin.signup.review_request` (review action needed).
  for (const admin of admins) {
    for (const key of ["admin.signup.new_provider", "admin.signup.review_request"]) {
      await deliver({
        to: admin.email,
        subject: `New cleaner sign-up: ${opts.applicantName}`,
        html,
        notification: { recipient: "ADMIN", key },
      }).catch((e) => console.error("admin signup-review", admin.email, key, e));
    }
  }
}

/** Provider email when they receive a tip on a job. Gated by `prov.payments.new_tip`. */
export async function sendProviderNewTip(opts: {
  to: string;
  providerName: string;
  jobId: string;
  jobNumber: number;
  tipAmount: number;
  clientName: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`You received a tip!`) +
      p(`Hi ${opts.providerName.split(" ")[0]}, <strong>${opts.clientName}</strong> just tipped you ${fmt(opts.tipAmount)} on job #${opts.jobNumber}.`) +
      btn("Open job", `${appUrl}/my-jobs/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `You got a ${fmt(opts.tipAmount)} tip 🎉`,
    html,
    notification: { recipient: "PROVIDER", key: "prov.payments.new_tip" },
  });
}

function payoutMethod(method?: string | null) {
  return method ? ` via ${method.toLowerCase().replace(/_/g, " ")}` : "";
}

/** Provider email confirming we received their payout (withdrawal) request. Gated by `prov.payout.request_received`. */
export async function sendProviderPayoutRequested(opts: {
  to: string;
  providerName: string;
  amount: number;
  paymentMethod?: string | null;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("We got your payout request") +
      p(`Hi ${opts.providerName.split(" ")[0]}, we've received your request to withdraw <strong>${fmt(opts.amount)}</strong>${payoutMethod(opts.paymentMethod)}. We'll email you again as soon as it's on its way.`) +
      btn("View my pay", `${appUrl}/my-pay`)
  );
  return deliver({
    to: opts.to,
    subject: `Payout request received — ${fmt(opts.amount)}`,
    html,
    notification: { recipient: "PROVIDER", key: "prov.payout.request_received" },
  });
}

/** Provider email when their payout (withdrawal) has been completed. Gated by `prov.payout.completed`. */
export async function sendProviderPayoutCompleted(opts: {
  to: string;
  providerName: string;
  amount: number;
  paymentMethod?: string | null;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("Your payout is on its way 🎉") +
      p(`Hi ${opts.providerName.split(" ")[0]}, your withdrawal of <strong>${fmt(opts.amount)}</strong>${payoutMethod(opts.paymentMethod)} has been completed.`) +
      btn("View my pay", `${appUrl}/my-pay`)
  );
  return deliver({
    to: opts.to,
    subject: `Payout completed — ${fmt(opts.amount)}`,
    html,
    notification: { recipient: "PROVIDER", key: "prov.payout.completed" },
  });
}

/** Admin email when a provider requests an instant payout. Gated by `admin.payout.request_received`. */
export async function sendAdminPayoutRequest(opts: {
  providerName: string;
  amount: number;
  paymentMethod?: string | null;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("Payout request received") +
      p(`<strong>${opts.providerName}</strong> requested a payout of <strong>${fmt(opts.amount)}</strong>${payoutMethod(opts.paymentMethod)}.`) +
      btn("Review withdrawals", `${appUrl}/withdrawals`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Payout request — ${opts.providerName} (${fmt(opts.amount)})`,
      html,
      notification: { recipient: "ADMIN", key: "admin.payout.request_received" },
    }).catch((e) => console.error("admin payout-request", admin.email, e));
  }
}

// ──────────────────────────────────────────────────────────────────────
// CRON-DRIVEN NOTIFICATIONS (Yellow batch)
// All helpers in this section are designed to be called from
// /api/cron/notifications. Each uses `notificationKey` on EmailLog so the
// dispatcher can be idempotent across multiple cron firings.
// ──────────────────────────────────────────────────────────────────────

interface JobReminderOpts {
  to: string;
  recipientName: string;
  jobId: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
  address: string;
  cleanerNames: string[];
  logId: string;
}

/** Admin "unassigned starts in N hours" — picks the row based on the window. */
export async function sendAdminUnassignedDeadline(opts: {
  window: "12h" | "4h" | "1h";
  jobId: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
  logId: string;
}) {
  const keyMap = {
    "12h": "admin.unassigned.starts_12h",
    "4h": "admin.unassigned.starts_4h",
    "1h": "admin.unassigned.starts_1h",
  } as const;
  const subjectMap = {
    "12h": "12 hours",
    "4h": "4 hours",
    "1h": "1 hour",
  } as const;
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Unassigned booking starts in ${subjectMap[opts.window]}`) +
      p(`Job #${opts.jobNumber} for <strong>${opts.clientName}</strong> has no cleaner assigned yet.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Start", `${fmtDate(opts.startTime)} at ${fmtTime(opts.startTime)}`],
      ]) +
      btn("Assign now", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Unassigned (${subjectMap[opts.window]}) — ${opts.clientName} (#${opts.jobNumber})`,
      html,
      notification: { recipient: "ADMIN", key: keyMap[opts.window] },
      logId: opts.logId,
    }).catch((e) => console.error("admin unassigned-deadline", admin.email, opts.window, e));
  }
}

/** Admin "Booking not clocked in" reminder. */
export async function sendAdminNotClockedIn(opts: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  cleanerNames: string[];
  startTime: string;
  logId: string;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("Cleaner hasn't clocked in") +
      p(`Job #${opts.jobNumber} for <strong>${opts.clientName}</strong> was supposed to start at ${fmtTime(opts.startTime)}. No clock-in yet.`) +
      p(`Assigned: ${opts.cleanerNames.join(", ") || "—"}`) +
      btn("Open job", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Not clocked in — ${opts.clientName} (#${opts.jobNumber})`,
      html,
      notification: { recipient: "ADMIN", key: "admin.clock.not_clocked_in" },
      logId: opts.logId,
    }).catch((e) => console.error("admin not-clocked-in", admin.email, e));
  }
}

/** Admin cash/check upcoming reminder. */
export async function sendAdminCashCheckReminder(opts: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
  paymentType: string;
  logId: string;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Upcoming cash/check booking`) +
      p(`Heads up — job #${opts.jobNumber} for <strong>${opts.clientName}</strong> uses ${opts.paymentType}. Cleaner should collect payment on-site.`) +
      btn("Open job", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `Cash/check upcoming — ${opts.clientName} (#${opts.jobNumber})`,
      html,
      notification: { recipient: "ADMIN", key: "admin.reminders.cash_check" },
      logId: opts.logId,
    }).catch((e) => console.error("admin cash-check", admin.email, e));
  }
}

/** Admin "Poor rating twice in a week" — fires once per cleaner per week. */
export async function sendAdminPoorRatingTwiceWeek(opts: {
  cleanerName: string;
  count: number;
  logId: string;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const html = layout(
    h1(`Multiple poor ratings — ${opts.cleanerName}`) +
      p(`<strong>${opts.cleanerName}</strong> received ${opts.count} ratings of 3/5 or lower in the past 7 days. Worth a check-in.`)
  );
  for (const admin of admins) {
    await deliver({
      to: admin.email,
      subject: `${opts.count} poor ratings this week — ${opts.cleanerName}`,
      html,
      notification: { recipient: "ADMIN", key: "admin.rating.poor_twice_week" },
      logId: opts.logId,
    }).catch((e) => console.error("admin poor-x2", admin.email, e));
  }
}

/** Customer 48h reminder (catalog key `cust.reminders.booking_reminder_2`). */
export async function sendCustomerReminder48h(opts: JobReminderOpts) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("Your Cleano cleaning is in 2 days") +
      p(`Hi ${opts.recipientName.split(" ")[0]}, just a heads-up that your cleaning is coming up in about 48 hours.`) +
      section([
        ["Date", fmtDate(opts.startTime)],
        ["Time", fmtTime(opts.startTime)],
        ["Address", opts.address],
      ]) +
      p(opts.cleanerNames.length > 0
        ? `Your cleaner${opts.cleanerNames.length > 1 ? "s" : ""}: <strong>${opts.cleanerNames.join(", ")}</strong>`
        : "We're finalizing your cleaner assignment.") +
      btn("View this booking", `${appUrl}/portal/bookings/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `Reminder: your Cleano cleaning is in 2 days`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.reminders.booking_reminder_2" },
    logId: opts.logId,
  });
}

/** Customer "Never found a provider" notification. */
export async function sendCustomerNeverFoundProvider(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  startTime: string;
  logId: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("We weren't able to staff your booking") +
      p(`Hi ${opts.clientName.split(" ")[0]}, unfortunately we couldn't find a cleaner for your booking on ${fmtDate(opts.startTime)}. The booking has been canceled and you won't be charged.`) +
      btn("Try a different time", `${appUrl}/book`)
  );
  return deliver({
    to: opts.to,
    subject: `We couldn't staff your Cleano booking #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.cancel.never_found_provider" },
    logId: opts.logId,
  });
}

/** Customer "Leave a tip" follow-up. */
export async function sendCustomerLeaveTip(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  cleanerNames: string[];
  logId: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1("Care to tip your cleaner?") +
      p(`Hi ${opts.clientName.split(" ")[0]}, if you enjoyed your cleaning, leaving a tip is a great way to show ${opts.cleanerNames.join(" and ") || "your cleaner"} you appreciated it.`) +
      btn("Add a tip", `${appUrl}/portal/bookings/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `Tip your cleaner for job #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.completed.leave_tip" },
    logId: opts.logId,
  });
}

/** Provider "One day reminder" + "One hour reminder" + unassigned-pool reminder. */
export async function sendProviderJobReminder(opts: {
  window: "1d" | "1h" | "unassigned_pool";
  to: string;
  providerName: string;
  jobId: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
  address: string;
  logId: string;
}) {
  const keyMap = {
    "1d": "prov.reminders.one_day",
    "1h": "prov.reminders.one_hour",
    unassigned_pool: "prov.reminders.unassigned",
  } as const;
  const subjMap = {
    "1d": "Your job tomorrow",
    "1h": "Job starts in 1 hour",
    unassigned_pool: "Open jobs available",
  } as const;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(subjMap[opts.window]) +
      p(`Hi ${opts.providerName.split(" ")[0]}, ${opts.window === "unassigned_pool" ? "there are unassigned jobs you can pick up." : `you have a job for ${opts.clientName} coming up.`}`) +
      (opts.window !== "unassigned_pool"
        ? section([
            ["Date", fmtDate(opts.startTime)],
            ["Time", fmtTime(opts.startTime)],
            ["Address", opts.address],
          ])
        : "") +
      btn("Open in app", `${appUrl}/my-jobs/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `${subjMap[opts.window]} — Cleano`,
    html,
    notification: { recipient: "PROVIDER", key: keyMap[opts.window] },
    logId: opts.logId,
  });
}

/**
 * Customer email when admin resolves their request (approve / deny, for
 * cancellation OR reschedule). Reuses the existing catalog rows:
 *   - cancellation approved → `cust.cancel.booking_cancellation` (separate helper)
 *   - everything else → `cust.booking.modified` (admin acted on the booking)
 */
export async function sendCustomerRequestResolved(opts: {
  to: string;
  clientName: string;
  jobId: string;
  jobNumber: number;
  startTime: string;
  address: string;
  serviceType: string | null;
  kind: "cancellation" | "reschedule";
  decision: "approve" | "deny";
  note?: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const title =
    opts.decision === "approve"
      ? opts.kind === "cancellation"
        ? "Your cancellation was approved"
        : "Your reschedule request was approved"
      : opts.kind === "cancellation"
      ? "Your cancellation request was declined"
      : "Your reschedule request was declined";

  const subject =
    opts.decision === "approve"
      ? opts.kind === "cancellation"
        ? `Cancellation approved — #${opts.jobNumber}`
        : `Reschedule approved — #${opts.jobNumber}`
      : opts.kind === "cancellation"
      ? `Cancellation request declined — #${opts.jobNumber}`
      : `Reschedule request declined — #${opts.jobNumber}`;

  const lead =
    opts.decision === "approve"
      ? opts.kind === "cancellation"
        ? `Hi ${opts.clientName.split(" ")[0]}, your cancellation has been approved. The booking won't proceed and you won't be charged.`
        : `Hi ${opts.clientName.split(" ")[0]}, we've received your reschedule request and we'll be in touch shortly to confirm a new time that works for both sides. There is no reschedule fee, and your deposit carries over to the rescheduled booking.`
      : opts.kind === "cancellation"
      ? `Hi ${opts.clientName.split(" ")[0]}, after reviewing your cancellation request we're not able to cancel this booking. The cleaning will go ahead as planned.`
      : `Hi ${opts.clientName.split(" ")[0]}, after reviewing your reschedule request we're keeping the original date and time. The cleaning will go ahead as planned. There is no reschedule fee, and your deposit stays on the booking.`;

  const html = layout(
    h1(title) +
      p(lead) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Date", fmtDate(opts.startTime)],
        ["Time", fmtTime(opts.startTime)],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
      ]) +
      (opts.note ? p(`<strong>Note from our team:</strong> ${opts.note}`) : "") +
      btn("View this booking", `${appUrl}/portal/bookings/${opts.jobId}`)
  );

  // Catalog mapping:
  //  - cancellation (approve OR deny) → `cust.cancel.booking_cancellation`
  //    so the admin's customer-cancel toggle controls both outcomes.
  //  - reschedule (approve OR deny) → `cust.booking.modified`
  //    (closest spec row for "we acted on your booking"). Defaults to EMAIL: true.
  const key =
    opts.kind === "cancellation"
      ? "cust.cancel.booking_cancellation"
      : "cust.booking.modified";

  return deliver({
    to: opts.to,
    subject,
    html,
    notification: { recipient: "CUSTOMER", key },
  });
}

/**
 * Provider email when their assigned booking is canceled. Picks the
 * `_after_5pm` variant when the cancel lands after 5 pm the day before.
 */
export async function sendProviderBookingCanceled(opts: {
  to: string;
  providerName: string;
  jobId: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
  address: string;
  serviceType: string | null;
  reason?: string | null;
}) {
  const after5 = isAfter5pmDayBefore(new Date(opts.startTime));
  const key = after5
    ? "prov.cancel.booking_canceled_after_5pm"
    : "prov.cancel.booking_canceled";
  const subject = after5
    ? `Late cancel (after 5 pm) — ${opts.clientName} (#${opts.jobNumber})`
    : `Booking canceled — ${opts.clientName} (#${opts.jobNumber})`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const html = layout(
    h1(after5 ? "Your job was canceled (late)" : "Your job was canceled") +
      p(
        `Hi ${opts.providerName.split(" ")[0]}, your scheduled job for <strong>${opts.clientName}</strong> has been canceled and is no longer on your schedule.`
      ) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Customer", opts.clientName],
        ["Was scheduled", `${fmtDate(opts.startTime)} at ${fmtTime(opts.startTime)}`],
        ["Address", opts.address],
        ["Service", opts.serviceType ?? "—"],
      ]) +
      (opts.reason ? p(`<strong>Reason:</strong> ${opts.reason}`) : "") +
      (after5
        ? p("Sorry about the short notice — your pay multiplier for late cancellations is honored where applicable.")
        : "") +
      btn("Open in app", `${appUrl}/my-jobs/${opts.jobId}`)
  );

  return deliver({
    to: opts.to,
    subject,
    html,
    notification: { recipient: "PROVIDER", key },
  });
}

/* ------------------------------------------------------------------ */
/*  Weekly + no-show + last-minute helpers (medium batch additions)   */
/* ------------------------------------------------------------------ */

/**
 * Weekly performance email to a single cleaner. Covers their last 7 days:
 * hours worked, jobs completed, average rating, and tip total.
 */
export async function sendProviderWeeklyPerformance(opts: {
  to: string;
  providerName: string;
  weekLabel: string;
  hours: number;
  jobsCompleted: number;
  avgRating: number | null;
  tipsTotal: number;
}) {
  const html = layout(
    h1(`Your week with Cleano`) +
      p(`Hi ${opts.providerName.split(" ")[0]}, here's a quick look at ${opts.weekLabel}.`) +
      section([
        ["Jobs completed", String(opts.jobsCompleted)],
        ["Hours worked", opts.hours.toFixed(1)],
        ["Average rating", opts.avgRating ? `${opts.avgRating.toFixed(1)} / 5` : "No ratings"],
        ["Tips received", fmt(opts.tipsTotal)],
      ]) +
      p(`Keep up the great work. You can see the full breakdown in the app.`)
  );
  return deliver({
    to: opts.to,
    subject: `Your week at Cleano — ${opts.weekLabel}`,
    html,
    notification: { recipient: "PROVIDER", key: "prov.report.weekly_performance" },
  });
}

/**
 * Weekly Rag Wash dashboard email to all admin recipients. Summarises the
 * last 7 days: rags credited, payouts issued, and jobs flagged for review.
 */
export async function sendAdminWeeklyRagWashDashboard(opts: {
  weekLabel: string;
  ragsCredited: number;
  padsCredited: number;
  payoutsCount: number;
  payoutsTotal: number;
  flaggedJobsCount: number;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Weekly Rag Wash — ${opts.weekLabel}`) +
      section([
        ["Rags credited", String(opts.ragsCredited)],
        ["Pads credited", String(opts.padsCredited)],
        ["Payouts issued", String(opts.payoutsCount)],
        ["Payout total", fmt(opts.payoutsTotal)],
        ["Jobs flagged for review", String(opts.flaggedJobsCount)],
      ]) +
      btn("Open wash payouts", `${appUrl}/wash-payouts`)
  );
  for (const admin of admins) {
    try {
      await deliver({
        to: admin.email,
        subject: `Weekly Rag Wash dashboard — ${opts.weekLabel}`,
        html,
        notification: { recipient: "ADMIN", key: "admin.report.weekly_ragwash" },
      });
    } catch (e) {
      console.error("Weekly Rag Wash email failed for", admin.email, e);
    }
  }
}

/** Admin email when a cleaner arrives late and the rating penalty kicks in. */
export async function sendAdminLateArrival(opts: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  cleanerName: string;
  minutesLate: number;
  penalty: number;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Late arrival — ${opts.cleanerName}`) +
      p(`<strong>${opts.cleanerName}</strong> clocked in <strong>${opts.minutesLate} min late</strong> for booking #${opts.jobNumber} (${opts.clientName}). This job's customer rating will be reduced by <strong>${opts.penalty} stars</strong>.`) +
      btn("Open job", `${appUrl}/jobs/${opts.jobId}`)
  );
  for (const admin of admins) {
    try {
      await deliver({
        to: admin.email,
        subject: `Late arrival — ${opts.cleanerName} (#${opts.jobNumber})`,
        html,
        notification: { recipient: "ADMIN", key: "admin.clock.late_arrival" },
      });
    } catch (e) {
      console.error("late-arrival admin email", admin.email, e);
    }
  }
}

/** Cleaner email when their own late arrival reduces their job rating. */
export async function sendProviderLateArrival(opts: {
  to: string;
  providerName: string;
  jobId: string;
  jobNumber: number;
  minutesLate: number;
  penalty: number;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Late arrival on booking #${opts.jobNumber}`) +
      p(`Hi ${opts.providerName.split(" ")[0]}, you clocked in <strong>${opts.minutesLate} min late</strong>. As per our service standards, your rating for this job will be reduced by <strong>${opts.penalty} stars</strong>.`) +
      p(`To avoid this in future, please clock in within 10 minutes of the booking start time.`) +
      btn("Open job", `${appUrl}/my-jobs/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `Late arrival on booking #${opts.jobNumber}`,
    html,
    notification: { recipient: "PROVIDER", key: "prov.clock.late_arrival" },
  });
}

/* ------------------------------------------------------------------ */
/*  Gift card helpers                                                 */
/* ------------------------------------------------------------------ */

/** Recipient delivery: branded card with optional personal message + code. */
export async function sendGiftCardToRecipient(opts: {
  to: string;
  recipientName: string;
  purchaserName: string;
  amount: number;
  code: string;
  personalMessage: string | null;
  coverKey: string;
}) {
  const cover = coverFor(opts.coverKey);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const imageUrl = appUrl ? `${appUrl}${cover.imagePath}` : cover.imagePath;
  const html = layout(
    `<div style="margin-bottom:24px;border-radius:14px;overflow:hidden;background:${cover.gradient};min-height:180px;display:flex;align-items:center;justify-content:center;color:#fff;text-align:center;padding:36px 24px;">
      <img src="${imageUrl}" alt="" style="display:none;max-width:100%;height:auto;" />
      <div>
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.9;">Cleano gift card</div>
        <div style="margin-top:10px;font-size:42px;font-weight:700;">$${opts.amount.toFixed(0)}</div>
      </div>
    </div>` +
      h1(`${opts.recipientName.split(" ")[0]}, you've got a Cleano gift card.`) +
      p(`<strong>${opts.purchaserName}</strong> sent you a $${opts.amount.toFixed(2)} Cleano gift card. It can be applied to any cleaning booking. Our minimum job price is $119, and the balance carries forward if there is any left.`) +
      (opts.personalMessage
        ? p(`<em>"${opts.personalMessage}"</em>`)
        : "") +
      section([["Gift card code", `<code style="font-family:monospace;font-size:16px;letter-spacing:0.06em;">${opts.code}</code>`]]) +
      btn("Redeem your gift card", `${appUrl}/gift-card/redeem?code=${encodeURIComponent(opts.code)}`) +
      p(`<small>You can redeem it now to add credit to your Cleano account, then apply it next time you book.</small>`)
  );
  return deliver({
    to: opts.to,
    subject: `${opts.purchaserName.split(" ")[0]} sent you a Cleano gift card`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.gift.delivery" },
  });
}

/** Purchaser receipt right after a successful gift card payment. */
export async function sendGiftCardPurchaserReceipt(opts: {
  to: string;
  purchaserName: string;
  recipientName: string;
  recipientEmail: string;
  amount: number;
  scheduledDeliveryDate: string | null;
}) {
  const sentLine = opts.scheduledDeliveryDate
    ? `We'll deliver it to <strong>${opts.recipientName}</strong> (${opts.recipientEmail}) on <strong>${new Date(opts.scheduledDeliveryDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</strong>.`
    : `We've sent it to <strong>${opts.recipientName}</strong> (${opts.recipientEmail}) just now.`;
  const html = layout(
    h1(`Thanks for your gift card purchase`) +
      p(`Hi ${opts.purchaserName.split(" ")[0]}, your $${opts.amount.toFixed(2)} Cleano gift card is paid and confirmed. ${sentLine}`) +
      p(`If you need to make changes (recipient address, scheduled date), reply to this email and we'll sort it.`)
  );
  return deliver({
    to: opts.to,
    subject: `Your Cleano gift card receipt`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.gift.purchase_receipt" },
  });
}

/** Confirmation to whoever redeemed the code. */
export async function sendGiftCardRedeemedConfirmation(opts: {
  to: string;
  recipientName: string;
  amount: number;
  newBalance: number;
}) {
  const html = layout(
    h1(`Gift card redeemed`) +
      p(`Hi ${opts.recipientName.split(" ")[0]}, we've added <strong>$${opts.amount.toFixed(2)}</strong> to your Cleano account. Your current credit balance is <strong>$${opts.newBalance.toFixed(2)}</strong>, and it will auto-apply the next time you're charged for a booking.`)
  );
  return deliver({
    to: opts.to,
    subject: `Gift card credit applied — $${opts.amount.toFixed(2)}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.gift.redeemed" },
  });
}

/** Admin alert when a gift card is purchased. */
export async function sendAdminGiftCardPurchased(opts: {
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  recipientEmail: string;
  amount: number;
  scheduledDeliveryDate: string | null;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const html = layout(
    h1(`New gift card — $${opts.amount.toFixed(2)}`) +
      section([
        ["From", `${opts.purchaserName} (${opts.purchaserEmail})`],
        ["To", `${opts.recipientName} (${opts.recipientEmail})`],
        ["Amount", `$${opts.amount.toFixed(2)}`],
        ["Delivery", opts.scheduledDeliveryDate
          ? `Scheduled for ${new Date(opts.scheduledDeliveryDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
          : "Immediate"],
      ])
  );
  for (const admin of admins) {
    try {
      await deliver({
        to: admin.email,
        subject: `Gift card purchased — $${opts.amount.toFixed(2)}`,
        html,
        notification: { recipient: "ADMIN", key: "admin.gift.purchased" },
      });
    } catch (e) {
      console.error("admin gift card email", admin.email, e);
    }
  }
}

/** Customer email when admin places a pre-auth hold on the card. */
export async function sendCustomerHoldPlaced(opts: {
  to: string;
  clientName: string;
  jobNumber: number;
  amountUsd: number;
}) {
  const html = layout(
    h1(`We placed a hold on your card`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, we've placed a temporary <strong>${fmt(opts.amountUsd)}</strong> authorization on your card for booking #${opts.jobNumber}. This is not a charge — it secures the funds until the cleaning is complete, at which point we'll capture the final amount.`) +
      p(`If your booking is cancelled before the cleaning, the hold is released and nothing is charged.`)
  );
  return deliver({
    to: opts.to,
    subject: `Hold placed for booking #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.hold.placed" },
  });
}

/** Customer email when a hold is released without capture. */
export async function sendCustomerHoldReleased(opts: {
  to: string;
  clientName: string;
  jobNumber: number;
}) {
  const html = layout(
    h1(`Your hold has been released`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, the pre-authorization hold for booking #${opts.jobNumber} has been released. Depending on your bank, the funds will return to your available balance within a few business days. You have not been charged.`)
  );
  return deliver({
    to: opts.to,
    subject: `Hold released for booking #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.hold.released" },
  });
}

/** Customer email when the capture at completion fails. */
export async function sendCustomerHoldCaptureFailed(opts: {
  to: string;
  clientName: string;
  jobNumber: number;
  reason: string;
}) {
  const html = layout(
    h1(`Action needed on your card`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, we tried to capture the payment for booking #${opts.jobNumber} but the card declined: <strong>${opts.reason}</strong>.`) +
      p(`Please update your card on file and we'll re-try the charge. The hold may have already been released depending on your bank.`)
  );
  return deliver({
    to: opts.to,
    subject: `Action needed — booking #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.hold.capture_failed" },
  });
}

/** Customer-facing confirmation that we received their quote request. */
export async function sendCustomerQuoteReceived(opts: {
  to: string;
  clientName: string;
  quoteId: string;
}) {
  const html = layout(
    h1(`We got your request`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, thanks for reaching out. We've received your quote request and a member of our team will follow up within one business day with pricing and next steps.`) +
      p(`If you need to add anything in the meantime, just reply to this email.`)
  );
  return deliver({
    to: opts.to,
    subject: `Cleano quote request received`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.quote.received" },
  });
}

/** Admin alert that a new quote landed in the inbox. */
export async function sendAdminQuoteRequest(opts: {
  quoteId: string;
  name: string;
  email: string;
  phone: string | null;
  serviceType: string | null;
  message: string | null;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`New quote request — ${opts.name}`) +
      section([
        ["Name", opts.name],
        ["Email", opts.email],
        ["Phone", opts.phone ?? "—"],
        ["Service", opts.serviceType ?? "—"],
      ]) +
      (opts.message ? p(`<strong>Message:</strong> ${opts.message}`) : "") +
      btn("Open quote inbox", `${appUrl}/quotes`)
  );
  for (const admin of admins) {
    try {
      await deliver({
        to: admin.email,
        subject: `New quote request — ${opts.name}`,
        html,
        notification: { recipient: "ADMIN", key: "admin.quote.new_request" },
      });
    } catch (e) {
      console.error("admin quote email failed for", admin.email, e);
    }
  }
}

/**
 * 1st-of-month statement: HTML summary + PDF attachment of the previous
 * month's bookings.
 */
export async function sendCustomerMonthlyStatement(opts: {
  to: string;
  clientName: string;
  monthLabel: string;
  periodStart: string;
  periodEnd: string;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  bookingsCount: number;
  pdf: Buffer;
}) {
  const html = layout(
    h1(`Your ${opts.monthLabel} statement`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, here's a summary of your activity from ${opts.periodStart} to ${opts.periodEnd}. The full statement is attached as a PDF.`) +
      section([
        ["Bookings", String(opts.bookingsCount)],
        ["Total billed", fmt(opts.totalBilled)],
        ["Total paid", fmt(opts.totalPaid)],
        ["Outstanding", fmt(opts.totalOutstanding)],
      ]) +
      p(`Thanks for being a Cleano customer.`)
  );
  return deliver({
    to: opts.to,
    subject: `Your ${opts.monthLabel} Cleano statement`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.reports.monthly_statement" },
    attachments: [
      {
        filename: `cleano-statement-${opts.monthLabel.replace(/\s+/g, "-").toLowerCase()}.pdf`,
        content: opts.pdf,
      },
    ],
  });
}

/** Customer email for a no-show fee with auto-1-star rating. */
export async function sendCustomerNoShowFee(opts: {
  to: string;
  clientName: string;
  jobNumber: number;
  feeUsd: number;
}) {
  const html = layout(
    h1(`No-show fee — booking #${opts.jobNumber}`) +
      p(`Hi ${opts.clientName.split(" ")[0]}, our cleaner arrived for booking #${opts.jobNumber} but no one was there to provide access. As outlined in our cancellation policy, a $${opts.feeUsd.toFixed(2)} no-show fee has been charged to your card on file.`) +
      p(`If you believe this was an error, please reply to this email and we'll review.`)
  );
  return deliver({
    to: opts.to,
    subject: `No-show fee charged — booking #${opts.jobNumber}`,
    html,
    notification: { recipient: "CUSTOMER", key: "cust.fee.no_show" },
  });
}

/**
 * Provider broadcast email when a job is reposted to the unassigned pool
 * because the assigned cleaner cancelled last minute. Whoever claims it
 * first gets the configured bonus on top of their normal pay.
 */
export async function sendProviderLastMinuteOpening(opts: {
  to: string;
  providerName: string;
  jobId: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
  address: string;
  bonusUsd: number;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`Last minute booking — $${opts.bonusUsd.toFixed(0)} bonus`) +
      p(`Hi ${opts.providerName.split(" ")[0]}, a booking just opened up. Whoever picks it up first gets a $${opts.bonusUsd.toFixed(2)} bonus on top of regular pay.`) +
      section([
        ["Booking #", String(opts.jobNumber)],
        ["Client", opts.clientName],
        ["When", `${fmtDate(opts.startTime)} · ${fmtTime(opts.startTime)}`],
        ["Address", opts.address],
      ]) +
      btn("Claim this booking", `${appUrl}/my-jobs/${opts.jobId}`)
  );
  return deliver({
    to: opts.to,
    subject: `Last minute booking — $${opts.bonusUsd.toFixed(0)} bonus`,
    html,
    notification: { recipient: "PROVIDER", key: "prov.unassigned.last_minute" },
  });
}

/**
 * Recurring-cancellation "save offer" check-in email. Includes an open-tracking
 * pixel and a click-tracked offer button (both route through /api/track/recurring).
 * `offerLabel` is null when no offer is configured (check-in only).
 */
export async function sendRecurringSaveOffer(opts: {
  to: string;
  clientName: string;
  cancellationId: string;
  intro: string;
  offerLabel: string | null;
  offerCode: string | null;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const firstName = opts.clientName.split(" ")[0] || opts.clientName;
  const clickUrl = `${appUrl}/api/track/recurring/${opts.cancellationId}/click`;
  const pixel = `<img src="${appUrl}/api/track/recurring/${opts.cancellationId}/open" width="1" height="1" alt="" style="display:none" />`;

  const offerBlock = opts.offerLabel
    ? p(`As a thank-you for giving us another try, here's <strong>${opts.offerLabel}</strong>${
        opts.offerCode ? ` — your code is <strong>${opts.offerCode}</strong>` : ""
      }.`) + btn("Rebook with my offer", clickUrl)
    : p(`We'd still love to have you back whenever you're ready.`) +
      btn("Book a cleaning", clickUrl);

  const html = layout(
    h1("Is everything okay?") +
      p(`Hi ${firstName},`) +
      p(opts.intro) +
      p(`If something went wrong, just reply to this email — a real person reads every response and we'd genuinely like to make it right.`) +
      offerBlock +
      pixel
  );

  return deliver({
    to: opts.to,
    subject: "We'd love to have you back — is everything okay?",
    html,
  });
}

/** Confirmation to a job applicant after they submit the careers form. */
export async function sendApplicantConfirmation(opts: {
  to: string;
  applicantName: string;
}) {
  const html = layout(
    h1("Thanks for applying to Cleano") +
      p(`Hi ${opts.applicantName.split(" ")[0]}, we've received your application to join the Cleano cleaning team.`) +
      p(`Our hiring team reviews every application. If you look like a good fit, we'll reach out by email or phone with the next steps.`) +
      p(`Thanks for your interest in working with us!`)
  );
  return deliver({
    to: opts.to,
    subject: "We received your Cleano application",
    html,
  });
}

/** Admin alert that a new job application landed. */
export async function sendAdminNewApplication(opts: {
  applicationId: string;
  name: string;
  email: string;
  phone: string | null;
  cityArea: string | null;
  hasTransport: boolean | null;
  resumeUrl: string | null;
}) {
  const admins = await fetchAdmins();
  if (admins.length === 0) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = layout(
    h1(`New job application — ${opts.name}`) +
      section([
        ["Name", opts.name],
        ["Email", opts.email],
        ["Phone", opts.phone ?? "—"],
        ["City / area", opts.cityArea ?? "—"],
        ["Has transport", opts.hasTransport == null ? "—" : opts.hasTransport ? "Yes" : "No"],
        ["Resume", opts.resumeUrl ? "Attached" : "Not provided"],
      ]) +
      btn("Open applications", `${appUrl}/job-applications`)
  );
  for (const admin of admins) {
    try {
      await deliver({
        to: admin.email,
        subject: `New job application — ${opts.name}`,
        html,
      });
    } catch (e) {
      console.error("admin application email failed for", admin.email, e);
    }
  }
}
