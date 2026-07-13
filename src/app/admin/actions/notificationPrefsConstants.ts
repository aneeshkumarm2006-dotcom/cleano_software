/**
 * Per-user notification preferences.
 *
 * Two things matter here and are easy to get wrong:
 *
 * 1. AUDIENCE. Some keys are the CLEANER's perspective ("your supplies are
 *    running low") and some are the ADMIN's ("a cleaner's stock crossed the
 *    refill threshold", "an invoice is overdue"). They are NOT duplicates of
 *    each other — `lowInventory` is the cleaner's own kit, `providerLowStock`
 *    is an ops signal about someone else's kit. `NOTIFICATION_AUDIENCE` is the
 *    single source of truth, and the settings UI filters its rows by it so a
 *    cleaner is never shown billing/ops toggles.
 *
 * 2. DEFAULTS. Defaults are what a user gets before they ever open settings, so
 *    they must differ by role. A cleaner is opted in to job-critical
 *    notifications only (they shouldn't be subscribed to everything on day
 *    one); an admin keeps everything on, which preserves existing ops alerting.
 *
 * Plain module (no server imports) — imported by both server actions and the
 * client settings UI.
 */

import { isAdminRole } from "@/lib/role-routing";

export type NotificationPrefs = {
  newJob: boolean;
  jobReminder: boolean;
  payProcessed: boolean;
  ratingReceived: boolean;
  documentToSign: boolean;
  trainingAssigned: boolean;
  multiplierChange: boolean;
  lowInventory: boolean;
  providerLowStock: boolean;
  cleanerPayment: boolean;
  immediatePayout: boolean;
  latePayment: boolean;
  clientComplaint: boolean;
  ratingDecrease: boolean;
  overdueCommercial: boolean;
};

export type NotificationKey = keyof NotificationPrefs;

/** Who a notification is actually for. Drives which rows each role can see. */
export type NotificationAudience = "cleaner" | "admin" | "both";

export const NOTIFICATION_AUDIENCE: Record<
  NotificationKey,
  NotificationAudience
> = {
  // Cleaner-facing: about the signed-in cleaner's own work, kit and pay.
  newJob: "cleaner",
  jobReminder: "cleaner",
  payProcessed: "cleaner",
  ratingReceived: "cleaner",
  documentToSign: "cleaner",
  trainingAssigned: "cleaner",
  multiplierChange: "cleaner",
  lowInventory: "cleaner",
  ratingDecrease: "cleaner",
  // Payout events matter to the cleaner being paid AND to the admin paying.
  cleanerPayment: "both",
  immediatePayout: "both",
  // Admin/ops/billing only — never shown in a cleaner's settings.
  providerLowStock: "admin",
  latePayment: "admin",
  clientComplaint: "admin",
  overdueCommercial: "admin",
};

/** Keys a given role is allowed to see/toggle. */
export function notificationKeysForRole(isAdmin: boolean): NotificationKey[] {
  return (Object.keys(NOTIFICATION_AUDIENCE) as NotificationKey[]).filter(
    (key) => {
      const audience = NOTIFICATION_AUDIENCE[key];
      return audience === "both" || audience === (isAdmin ? "admin" : "cleaner");
    }
  );
}

/**
 * Admin/ops default: everything on. Ops alerting (overdue invoices, complaints,
 * provider low stock) must keep firing for admins who have never touched their
 * settings — this preserves today's behavior exactly.
 */
export const ADMIN_DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  newJob: true,
  jobReminder: true,
  payProcessed: true,
  ratingReceived: true,
  documentToSign: true,
  trainingAssigned: true,
  multiplierChange: true,
  lowInventory: true,
  providerLowStock: true,
  cleanerPayment: true,
  immediatePayout: true,
  latePayment: true,
  clientComplaint: true,
  ratingDecrease: true,
  overdueCommercial: true,
};

/**
 * Cleaner default: job-critical only. A new cleaner is NOT subscribed to
 * everything on day one — they opt in to the rest from Settings → Notifications.
 * Admin/billing keys are false here as a belt-and-braces backstop: they are
 * already filtered out of the cleaner UI and routed by role, so a cleaner
 * should never be a recipient of one anyway.
 */
export const CLEANER_DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  // On: the two job notifications a cleaner has to see to do the job.
  newJob: true,
  jobReminder: true,
  // Off by default — opt-in.
  payProcessed: false,
  ratingReceived: false,
  documentToSign: false,
  trainingAssigned: false,
  multiplierChange: false,
  lowInventory: false,
  cleanerPayment: false,
  immediatePayout: false,
  ratingDecrease: false,
  // Admin-only keys: never applicable to a cleaner.
  providerLowStock: false,
  latePayment: false,
  clientComplaint: false,
  overdueCommercial: false,
};

/**
 * Defaults for a user, by role. Unknown/missing role falls back to the cleaner
 * (least-subscribed) set rather than the admin set — fail closed.
 */
export function defaultPrefsForRole(
  role: string | null | undefined
): NotificationPrefs {
  return isAdminRole(role)
    ? ADMIN_DEFAULT_NOTIFICATION_PREFS
    : CLEANER_DEFAULT_NOTIFICATION_PREFS;
}
