import { db } from "@/lib/org-db";
import type { AlertType, AlertSeverity, Roles } from "@prisma/client";
import { alertAlreadyOpen } from "./alert-dedupe";

/** Roles that receive admin alerts — same set as the admin email recipients. */
const ADMIN_ROLES: Roles[] = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"];

/**
 * Raise one in-app Alert for the admin team.
 *
 * This used to write one row PER admin user (`recipientUserId: a.id`), which is
 * the direct cause of client feedback item 25 — the reported pair of identical
 * "Assignment unconfirmed" rows, same title, same body, same timestamp, was one
 * logical alert fanned out to two admins. The single consumer of the Alert
 * table, /admin/analytics → Alerts, queries `{ isDismissed: false }` with NO
 * recipient filter, so every copy rendered as its own row and dismissing one
 * left the rest behind.
 *
 * A broadcast row (`recipientUserId: null`) is what that reader actually wants,
 * and it is already the shape ten of the twelve other alert-creation sites use.
 * Every admin still sees the alert; they see it once, and dismissing it clears
 * it. Per-recipient fan-out remains available via `notifyByRule`, where it earns
 * its keep by applying each user's notification preferences.
 *
 * Best-effort; never throws into the caller.
 */
export async function notifyAdmins(input: {
  type?: AlertType;
  severity?: AlertSeverity;
  title: string;
  message: string;
  relatedId?: string | null;
  relatedType?: string | null;
}): Promise<void> {
  try {
    // Nobody to tell → don't leave a row addressed to a team that doesn't exist.
    const adminCount = await db.user.count({
      where: { role: { in: ADMIN_ROLES }, isActive: true },
    });
    if (adminCount === 0) return;

    const identity = {
      type: input.type ?? ("GENERAL" as const),
      title: input.title,
      message: input.message,
      relatedId: input.relatedId ?? null,
      recipientUserId: null,
    };
    // A repeated trigger (cron re-run, re-invite) must not restack a notice the
    // team hasn't cleared yet.
    if (await alertAlreadyOpen(identity)) return;

    await db.alert.create({
      data: {
        ...identity,
        severity: input.severity ?? "INFO",
        relatedType: input.relatedType ?? null,
      },
    });
  } catch (e) {
    console.error("notifyAdmins", e);
  }
}
