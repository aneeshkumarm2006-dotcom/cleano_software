"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { RECURRING_FREQUENCIES } from "@/lib/retention-constants";
import type { ServiceFrequency } from "@prisma/client";

export interface RetentionClientRow {
  clientId: string;
  name: string;
  email: string | null;
  frequency: string | null;
  startDate: string;
  cancelledAt: string | null;
  reactivatedAt: string | null;
  repliedAt: string | null;
  offerStatus: string | null;
  cancellationId: string | null;
}

export interface RetentionKpi {
  startingCount: number;
  retainedCount: number;
  cancelledCount: number;
  reactivatedCount: number;
  pausedCount: number;
  retentionRate: number | null;
  churnRate: number | null;
  retained: RetentionClientRow[];
  cancelled: RetentionClientRow[];
  reactivated: RetentionClientRow[];
  paused: RetentionClientRow[];
}

const RECUR = RECURRING_FREQUENCIES as readonly string[];

/**
 * Recurring-client retention for a period [from, to].
 *
 *   starting   = recurring clients active at the start of the period
 *              ≈ still-recurring now + those who cancelled during the period
 *   retained   = recurring clients who stayed active and didn't cancel
 *   churnRate  = cancelled / starting × 100
 *   retention  = retained / starting × 100
 */
export async function getRetentionKpi(input: {
  from: string;
  to: string;
}): Promise<{ success: false; error: string } | ({ success: true } & RetentionKpi)> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role === "EMPLOYEE") return { success: false, error: "Not authorized" };

  const from = new Date(input.from);
  const to = new Date(`${input.to}T23:59:59.999`);

  const [retainedClients, cancellations, pausedClients] = await Promise.all([
    // Still recurring + active, and a client before the period ended.
    db.client.findMany({
      where: {
        serviceFrequency: { in: RECUR as ServiceFrequency[] },
        isActive: true,
        createdAt: { lte: to },
      },
      select: { id: true, name: true, email: true, serviceFrequency: true, createdAt: true },
      take: 500,
      orderBy: { name: "asc" },
    }),
    // Recurring-service cancellations during the period.
    db.recurringCancellation.findMany({
      where: { cancelledAt: { gte: from, lte: to } },
      orderBy: { cancelledAt: "desc" },
      take: 500,
      include: { client: { select: { id: true, name: true, email: true, createdAt: true } } },
    }),
    // Recurring clients currently deactivated (paused) without a cancellation.
    db.client.findMany({
      where: {
        serviceFrequency: { in: RECUR as ServiceFrequency[] },
        isActive: false,
        createdAt: { lte: to },
      },
      select: { id: true, name: true, email: true, serviceFrequency: true, createdAt: true },
      take: 200,
      orderBy: { name: "asc" },
    }),
  ]);

  const retained: RetentionClientRow[] = retainedClients.map((c) => ({
    clientId: c.id,
    name: c.name,
    email: c.email,
    frequency: c.serviceFrequency,
    startDate: c.createdAt.toISOString(),
    cancelledAt: null,
    reactivatedAt: null,
    repliedAt: null,
    offerStatus: null,
    cancellationId: null,
  }));

  const cancelled: RetentionClientRow[] = cancellations.map((rc) => ({
    clientId: rc.clientId,
    name: rc.client?.name ?? "—",
    email: rc.client?.email ?? null,
    frequency: rc.frequency,
    startDate: rc.client?.createdAt.toISOString() ?? rc.cancelledAt.toISOString(),
    cancelledAt: rc.cancelledAt.toISOString(),
    reactivatedAt: rc.reactivatedAt?.toISOString() ?? null,
    repliedAt: rc.repliedAt?.toISOString() ?? null,
    offerStatus: rc.offerStatus,
    cancellationId: rc.id,
  }));

  const reactivated = cancelled.filter(
    (c) => c.reactivatedAt && new Date(c.reactivatedAt) >= from && new Date(c.reactivatedAt) <= to
  );

  const paused: RetentionClientRow[] = pausedClients.map((c) => ({
    clientId: c.id,
    name: c.name,
    email: c.email,
    frequency: c.serviceFrequency,
    startDate: c.createdAt.toISOString(),
    cancelledAt: null,
    reactivatedAt: null,
    repliedAt: null,
    offerStatus: null,
    cancellationId: null,
  }));

  // Distinct clients in each bucket.
  const cancelledClientIds = new Set(cancelled.map((c) => c.clientId));
  const retainedCount = retained.length;
  const cancelledCount = cancelledClientIds.size;
  const startingCount = retainedCount + cancelledCount;

  const retentionRate =
    startingCount > 0 ? Math.round((retainedCount / startingCount) * 1000) / 10 : null;
  const churnRate =
    startingCount > 0 ? Math.round((cancelledCount / startingCount) * 1000) / 10 : null;

  return {
    success: true,
    startingCount,
    retainedCount,
    cancelledCount,
    reactivatedCount: reactivated.length,
    pausedCount: paused.length,
    retentionRate,
    churnRate,
    retained,
    cancelled,
    reactivated,
    paused,
  };
}
