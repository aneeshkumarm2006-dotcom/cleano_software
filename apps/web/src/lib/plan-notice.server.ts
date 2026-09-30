// The plan reminder for the workspace this request is on (lib/plan-notice.ts).
import "server-only";

import { requireOrgId } from "@/lib/org";
import { platformDb } from "@/lib/platform-db";

import { planNoticeFor, type PlanNotice } from "./plan-notice";

/**
 * Null when there is nothing to say, and on any failure: a reminder to pay is
 * never worth breaking the page it sits on.
 */
export async function currentPlanNotice(): Promise<PlanNotice | null> {
  try {
    const orgId = await requireOrgId();
    const org = await platformDb.organization.findUnique({
      where: { id: orgId },
      select: {
        createdAt: true,
        subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true } },
      },
    });
    if (!org?.subscription) return null;
    return planNoticeFor({ orgCreatedAt: org.createdAt, ...org.subscription });
  } catch {
    return null;
  }
}
