import { db } from "@/lib/org-db";
import type { ActivityCategory, ActivityStatus } from "@prisma/client";

export interface LogActivityInput {
  category: ActivityCategory;
  action: string;
  status?: ActivityStatus; // defaults to SUCCESS
  actorId?: string | null;
  actorLabel?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  message?: string | null;
  error?: string | null;
  amount?: number | null;
  providerId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Fire-and-forget activity-log write. NEVER throws — logging must not break the
 * action it's recording. If the ActivityLog table doesn't exist yet (migration
 * not applied), it just console.errors and moves on.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        category: input.category,
        action: input.action,
        status: input.status ?? "SUCCESS",
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        message: input.message ?? null,
        error: input.error ?? null,
        amount: input.amount ?? null,
        providerId: input.providerId ?? null,
        metadata: (input.metadata ?? undefined) as never,
      },
    });
  } catch (e) {
    console.error("[activity-log] write failed", e);
  }
}
