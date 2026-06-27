import { db } from "@/db";
import type { AlertType, AlertSeverity, Roles } from "@prisma/client";

/** Roles that receive admin alerts — same set as the admin email recipients. */
const ADMIN_ROLES: Roles[] = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"];

/**
 * Create an in-app Alert for every active admin/staff user — the same audience
 * that gets other admin alerts. Best-effort; never throws into the caller.
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
    const admins = await db.user.findMany({
      where: { role: { in: ADMIN_ROLES }, isActive: true },
      select: { id: true },
    });
    if (!admins.length) return;
    await db.alert.createMany({
      data: admins.map((a) => ({
        type: input.type ?? "GENERAL",
        severity: input.severity ?? "INFO",
        title: input.title,
        message: input.message,
        recipientUserId: a.id,
        relatedId: input.relatedId ?? null,
        relatedType: input.relatedType ?? null,
      })),
    });
  } catch (e) {
    console.error("notifyAdmins", e);
  }
}
