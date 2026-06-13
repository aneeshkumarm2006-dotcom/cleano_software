/**
 * Twilio SMS sender.
 *
 * Wired to four notification keys per client confirmation:
 *   - Booking confirmation
 *   - "On the way"
 *   - Reminders
 *   - Cancellation
 *
 * No-op until the Twilio env vars are present, so the app keeps running
 * before credentials are pasted in. Set these in .env.local (dev) and
 * Vercel project env (prod):
 *
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER             (E.164, e.g. +15551234567)
 *   TWILIO_MESSAGING_SERVICE_SID   (alternative to TWILIO_FROM_NUMBER)
 */

import { isNotificationEnabled } from "./notifications";
import type { Recipient } from "./notifications/catalog";
import { logActivity } from "./activity-log";

export interface SmsGate {
  recipient: Recipient;
  key: string;
}

interface SendSmsInput {
  to: string;
  body: string;
  notification?: SmsGate;
}

interface SendResult {
  sent: boolean;
  reason?: string;
  twilioSid?: string;
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)
  );
}

function normalizeE164(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+") && /^\+\d{8,15}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function sendSms(input: SendSmsInput): Promise<SendResult> {
  // Record every SMS attempt to the activity log (success/failure/skipped).
  const record = async (r: SendResult): Promise<SendResult> => {
    await logActivity({
      category: "SMS",
      action: input.notification?.key ?? "send_sms",
      status: r.sent
        ? "SUCCESS"
        : r.reason === "disabled-by-catalog"
        ? "SKIPPED"
        : "FAILED",
      targetType: "phone",
      targetId: input.to,
      message: input.body.slice(0, 160),
      error: r.sent ? null : r.reason ?? null,
      providerId: r.twilioSid ?? null,
    });
    return r;
  };

  if (input.notification) {
    const allowed = await isNotificationEnabled(
      input.notification.recipient,
      input.notification.key,
      "SMS"
    );
    if (!allowed) return record({ sent: false, reason: "disabled-by-catalog" });
  }

  if (!twilioConfigured()) {
    return record({ sent: false, reason: "twilio-not-configured" });
  }

  const to = normalizeE164(input.to);
  if (!to) return record({ sent: false, reason: "invalid-phone" });

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER;
  const msgService = process.env.TWILIO_MESSAGING_SERVICE_SID;

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("Body", input.body);
  if (msgService) params.set("MessagingServiceSid", msgService);
  else if (from) params.set("From", from);

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );
    const data = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok) {
      console.error("Twilio send failed:", res.status, data);
      return record({ sent: false, reason: data.message ?? `http-${res.status}` });
    }
    return record({ sent: true, twilioSid: data.sid });
  } catch (err) {
    console.error("Twilio send error:", err);
    return record({ sent: false, reason: "network-error" });
  }
}

/* ---------------------------------------------------------------------- */
/* Convenience wrappers for the four enabled events. Use these so the     */
/* catalog key + body shape stay consistent at every call site.           */
/* ---------------------------------------------------------------------- */

export function smsBookingConfirmation(opts: {
  to: string;
  jobNumber: number;
  startTime: string;
}) {
  const when = new Date(opts.startTime).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return sendSms({
    to: opts.to,
    body: `Cleano: booking #${opts.jobNumber} confirmed for ${when}. Reply STOP to opt out.`,
    notification: { recipient: "CUSTOMER", key: "cust.booking.confirmed" },
  });
}

export function smsOnTheWay(opts: {
  to: string;
  cleanerName: string;
  etaMin: number;
}) {
  return sendSms({
    to: opts.to,
    body: `Cleano: ${opts.cleanerName} is on the way, about ${opts.etaMin} min out.`,
    notification: { recipient: "CUSTOMER", key: "cust.booking.on_the_way" },
  });
}

export function smsReminder(opts: {
  to: string;
  jobNumber: number;
  startTime: string;
}) {
  const when = new Date(opts.startTime).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return sendSms({
    to: opts.to,
    body: `Cleano reminder: booking #${opts.jobNumber} is scheduled for ${when}.`,
    notification: { recipient: "CUSTOMER", key: "cust.reminders.booking_reminder_2" },
  });
}

export function smsCancellation(opts: {
  to: string;
  jobNumber: number;
  reason?: string;
}) {
  const tail = opts.reason ? ` (${opts.reason})` : "";
  return sendSms({
    to: opts.to,
    body: `Cleano: booking #${opts.jobNumber} has been canceled${tail}. We'll be in touch.`,
    notification: { recipient: "CUSTOMER", key: "cust.cancel.booking_cancellation" },
  });
}
