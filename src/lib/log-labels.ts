// Plain-English translation for the activity/audit log.
// The log stores internal codes (notification keys, EmailKind enums, Stripe
// event types, cuid targets). Non-technical admins read this page, so we
// translate every code into a human sentence here, server-side.

import { NOTIFICATION_CATALOG } from "./notifications/catalog";

// key (e.g. "prov.reminders.one_hour") → label (e.g. "One hour reminder")
const NOTIFICATION_LABELS = new Map(
  NOTIFICATION_CATALOG.map((e) => [e.key, e.label] as const),
);

const EMAIL_KIND_LABEL: Record<string, string> = {
  BOOKING_CONFIRMATION: "Booking confirmation",
  REMINDER_24H: "24-hour reminder",
  RECEIPT: "Payment receipt",
  REFUND: "Refund email",
  WAITLIST_AVAILABLE: "Waitlist spot available",
  RATING_REQUEST: "Review request",
  PASSWORD_SETUP: "Account setup",
  OTHER: "Notification",
};

const ACTION_LABEL: Record<string, string> = {
  charge_job: "Card charged",
  issue_refund: "Refund issued",
  redeem_gift_card: "Gift card redeemed",
  login: "Sign-in",
  login_denied: "Sign-in denied",
  send_sms: "Text message",
  reminders: "Reminders sent",
  "cron.reminders": "Reminders sent",
  weekly: "Weekly summary",
  "cron.weekly": "Weekly summary",
  monthly: "Monthly rollup",
  "cron.monthly": "Monthly rollup",
  notifications: "Notifications run",
  "cron.notifications": "Notifications run",
  // Stripe webhook event types
  "payment_intent.succeeded": "Payment succeeded",
  "payment_intent.payment_failed": "Payment failed",
  "charge.succeeded": "Charge succeeded",
  "charge.refunded": "Charge refunded",
  "charge.dispute.created": "Payment disputed",
  "checkout.session.completed": "Checkout completed",
};

const TARGET_TYPE_LABEL: Record<string, string> = {
  job: "Job",
  gift_card: "Gift card",
  user: "User",
  phone: "Phone",
  event: "Stripe event",
  report: "Report",
  job_batch: "Batch",
  email: "Email",
};

// Title-case a snake/dotted code as a last-resort fallback.
function humanize(s: string): string {
  return s
    .replace(/^(prov|cust|admin)\./, "")
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// A cuid-style opaque database id we should never show a human.
function isOpaqueId(s: string): boolean {
  return /^c[a-z0-9]{20,}$/i.test(s) || /^[0-9a-f-]{32,}$/i.test(s);
}

/** Friendly headline for an email row. */
export function emailTitle(
  kind: string,
  notificationKey: string | null,
  subject: string | null,
): string {
  if (kind !== "OTHER") return EMAIL_KIND_LABEL[kind] ?? humanize(kind);
  const key = notificationKey ?? subject ?? "";
  if (NOTIFICATION_LABELS.has(key)) return NOTIFICATION_LABELS.get(key)!;
  return key ? humanize(key) : "Notification";
}

/** Friendly headline for an activity row (SMS/payment/webhook/auth/cron). */
export function actionTitle(action: string): string {
  if (NOTIFICATION_LABELS.has(action)) return NOTIFICATION_LABELS.get(action)!;
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  return humanize(action);
}

/** Real, human email subject line — or null if it's just an internal code. */
export function humanSubject(
  subject: string | null,
  notificationKey: string | null,
): string | null {
  if (!subject) return null;
  if (subject === notificationKey) return null;
  if (NOTIFICATION_LABELS.has(subject)) return null; // it's a key, not a subject
  return subject;
}

/**
 * Friendly label for a log target. Jobs resolve to "Job #123 — Client name"
 * via the supplied lookup; opaque database ids are dropped entirely.
 */
export function targetLabel(
  targetType: string | null,
  targetId: string | null,
  jobs?: Map<string, { jobNumber: number; clientName: string | null }>,
): string | null {
  if (!targetType && !targetId) return null;
  if (targetType === "job" && targetId) {
    const j = jobs?.get(targetId);
    if (j) return `Job #${j.jobNumber}${j.clientName ? ` — ${j.clientName}` : ""}`;
    return "Job";
  }
  const name = targetType ? TARGET_TYPE_LABEL[targetType] ?? humanize(targetType) : "";
  if (targetId && !isOpaqueId(targetId)) {
    return name ? `${name} · ${targetId}` : targetId;
  }
  return name || null;
}
