"use server";

import { db } from "@/db";
import { revalidatePath } from "next/cache";
import type { AlertType, AlertSeverity, Prisma } from "@prisma/client";
import {
  defaultPrefsForRole,
  type NotificationPrefs,
} from "./notificationPrefsConstants";
import { getActor, requireOwnerAdmin } from "@/lib/action-guards";
import { alertAlreadyOpen, withoutDuplicateAlerts } from "@/lib/alert-dedupe";

interface CreateAlertInput {
  type: AlertType;
  severity?: AlertSeverity;
  title: string;
  message: string;
  relatedId?: string;
  relatedType?: string;
  recipientUserId?: string;
}

export async function createAlert(input: CreateAlertInput) {
  try {
    const guard = await requireOwnerAdmin();
    if (!guard.ok) return { success: false, error: guard.error };

    // An identical alert still sitting undismissed is the one the recipient is
    // already looking at; a second copy adds nothing but a row (item 25).
    if (await alertAlreadyOpen(input)) {
      return { success: true, deduped: true as const };
    }

    const alert = await db.alert.create({
      data: {
        type: input.type,
        severity: input.severity ?? "WARNING",
        title: input.title,
        message: input.message,
        relatedId: input.relatedId ?? null,
        relatedType: input.relatedType ?? null,
        recipientUserId: input.recipientUserId ?? null,
      },
    });
    return { success: true, alert };
  } catch (error) {
    console.error("Error creating alert:", error);
    return { success: false, error: "Failed to create alert" };
  }
}

// Dismiss/read are scoped: an admin can act on any alert; anyone else only on
// alerts addressed to them (recipientUserId). Blocks anonymous/customer access.
async function canMutateAlert(alertId: string) {
  const actor = await getActor();
  if (!actor.userId) return { ok: false as const, error: "Not authenticated" };
  const alert = await db.alert.findUnique({
    where: { id: alertId },
    select: { recipientUserId: true },
  });
  if (!alert) return { ok: false as const, error: "Alert not found" };
  const isAdmin = actor.role === "OWNER" || actor.role === "ADMIN";
  if (!isAdmin && alert.recipientUserId !== actor.userId) {
    return { ok: false as const, error: "Not authorized" };
  }
  return { ok: true as const };
}

export async function dismissAlert(alertId: string) {
  try {
    const auth = await canMutateAlert(alertId);
    if (!auth.ok) return { success: false, error: auth.error };
    await db.alert.update({
      where: { id: alertId },
      data: { isDismissed: true },
    });
    // /admin/analytics is the only page that reads the Alert table, and it's a
    // server component — without this the row stays on screen and the count
    // never moves, which reads as "the button does nothing".
    revalidatePath("/admin/analytics");
    return { success: true };
  } catch (error) {
    console.error("Error dismissing alert:", error);
    return { success: false, error: "Failed to dismiss alert" };
  }
}

export async function markAlertRead(alertId: string) {
  try {
    const auth = await canMutateAlert(alertId);
    if (!auth.ok) return { success: false, error: auth.error };
    await db.alert.update({
      where: { id: alertId },
      data: { isRead: true },
    });
    revalidatePath("/admin/analytics");
    return { success: true };
  } catch (error) {
    console.error("Error marking alert as read:", error);
    return { success: false, error: "Failed to mark alert as read" };
  }
}

// ── Spec-driven notification routing (§11.1, §11.2) ────────────────
// Maps each AlertType to the NotificationPrefs key that gates delivery.
// AlertTypes absent from this map (CANCELLATION, GENERAL) skip per-user
// pref filtering and fan out to every routed recipient.
const ALERT_TYPE_TO_PREF_KEY: Partial<
  Record<AlertType, keyof NotificationPrefs>
> = {
  LOW_INVENTORY: "lowInventory",
  PROVIDER_LOW_STOCK: "providerLowStock",
  CLEANER_PAYMENT: "cleanerPayment",
  IMMEDIATE_PAYOUT: "immediatePayout",
  OVERDUE_PAYMENT: "latePayment",
  OVERDUE_COMMERCIAL: "overdueCommercial",
  CLIENT_COMPLAINT: "clientComplaint",
  RATING_DECREASE: "ratingDecrease",
};

const PREFS_KEY_PREFIX = "notifications.prefs.";

interface NotifyByRulePayload {
  severity?: AlertSeverity;
  title: string;
  message: string;
  relatedId?: string;
  relatedType?: string;
  /**
   * Direct recipients to merge with role-based recipients (e.g. the cleaner
   * whose payout was processed). Per-user pref filtering still applies.
   */
  extraRecipientUserIds?: string[];
  /** When true, role expansion is skipped — only extraRecipientUserIds receive the alert. */
  skipRoleRouting?: boolean;
}

interface NotifyByRuleResult {
  success: boolean;
  created?: number;
  error?: string;
}

/**
 * Look up active AlertRoutingRule rows for the given alertType, expand each
 * rule to the set of users holding that role, merge in any direct recipients,
 * filter by per-user NotificationPrefs, and fan out one Alert row per user
 * (with recipientUserId set). Returns the number of rows created.
 */
export async function notifyByRule(
  alertType: AlertType,
  payload: NotifyByRulePayload,
): Promise<NotifyByRuleResult> {
  try {
    const guard = await requireOwnerAdmin();
    if (!guard.ok) return { success: false, error: guard.error };

    const recipientIds = new Set<string>();

    if (!payload.skipRoleRouting) {
      const rules = await db.alertRoutingRule.findMany({
        where: { alertType, isActive: true },
        select: { recipientRole: true },
      });
      if (rules.length > 0) {
        const usersByRole = await db.user.findMany({
          where: { role: { in: rules.map((r) => r.recipientRole) } },
          select: { id: true },
        });
        for (const u of usersByRole) recipientIds.add(u.id);
      }
    }

    for (const id of payload.extraRecipientUserIds ?? []) {
      recipientIds.add(id);
    }

    if (recipientIds.size === 0) {
      return { success: true, created: 0 };
    }

    const prefKey = ALERT_TYPE_TO_PREF_KEY[alertType];
    const prefsByUserId = new Map<string, NotificationPrefs>();
    if (prefKey) {
      // Defaults are role-dependent (a cleaner who has never opened settings is
      // opted in to job notifications only; an admin keeps ops alerting on), so
      // resolve each recipient's role before falling back.
      const ids = [...recipientIds];
      const [recipients, settings] = await Promise.all([
        db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, role: true },
        }),
        db.appSetting.findMany({
          where: { key: { in: ids.map((id) => PREFS_KEY_PREFIX + id) } },
          select: { key: true, value: true },
        }),
      ]);

      const defaultsByUserId = new Map<string, NotificationPrefs>();
      for (const u of recipients) {
        defaultsByUserId.set(u.id, defaultPrefsForRole(u.role));
      }
      for (const s of settings) {
        const uid = s.key.slice(PREFS_KEY_PREFIX.length);
        const defaults =
          defaultsByUserId.get(uid) ?? defaultPrefsForRole(undefined);
        const stored = s.value as Partial<NotificationPrefs>;
        prefsByUserId.set(uid, { ...defaults, ...stored });
      }
      // Recipients with no stored row fall back to their role defaults.
      for (const [uid, defaults] of defaultsByUserId) {
        if (!prefsByUserId.has(uid)) prefsByUserId.set(uid, defaults);
      }
    }

    const data: Prisma.AlertCreateManyInput[] = [];
    for (const userId of recipientIds) {
      if (prefKey) {
        // Fail closed: an unknown recipient (no User row) gets no alert.
        const prefs = prefsByUserId.get(userId);
        if (!prefs || !prefs[prefKey]) continue;
      }
      data.push({
        type: alertType,
        severity: payload.severity ?? "WARNING",
        title: payload.title,
        message: payload.message,
        relatedId: payload.relatedId ?? null,
        relatedType: payload.relatedType ?? null,
        recipientUserId: userId,
      });
    }

    if (data.length === 0) {
      return { success: true, created: 0 };
    }

    // Same rule as createAlert, applied across the fan-out: a recipient who is
    // still looking at this exact alert doesn't get a second one (item 25).
    const fresh = await withoutDuplicateAlerts(data);
    if (fresh.length === 0) {
      return { success: true, created: 0 };
    }

    const result = await db.alert.createMany({ data: fresh });
    return { success: true, created: result.count };
  } catch (error) {
    console.error("Error in notifyByRule:", error);
    return { success: false, error: "Failed to route alerts" };
  }
}
