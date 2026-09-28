import { NextRequest, NextResponse } from "next/server";

import { ACTIVITY_RETENTION_MS } from "@bookmops/core/time";

import { isAuthorizedCron } from "@/lib/cron-auth";
import { platformDb } from "@/lib/platform-db";
import { deleteExpiredRateLimits } from "@/lib/shared-rate-limit";

/**
 * The nightly sweep of the phone API's short-lived rows.
 *
 *   IdempotencyRecord    past expiresAt (30 days: longer than any correction
 *                        window). An expired key is already free again
 *                        (server/v1/idempotency.ts), so this only stops the
 *                        table growing forever.
 *   UserRequestActivity  older than the offline-clock rule reads (~15 min);
 *                        the v1 wrapper prunes each person as they come back,
 *                        this catches everyone who doesn't.
 *   RateLimitCounter     past its window.
 *
 * Deletes only by age, across every company, so it runs on the platform
 * client like the subscriptions cron. It reads nothing and returns counts.
 *
 * vercel.json: { "path": "/api/cron/api-retention", "schedule": "30 8 * * *" }
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const counts: Record<string, number> = {};
  let failed = false;

  const step = async (name: string, run: () => Promise<number>) => {
    try {
      counts[name] = await run();
    } catch (e) {
      failed = true;
      counts[name] = -1;
      console.error(JSON.stringify({ at: "cron.api-retention", step: name, error: String(e).slice(0, 200) }));
    }
  };

  await step("idempotency", async () => {
    const res = await platformDb.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } });
    return res.count;
  });
  await step("activity", async () => {
    const before = Math.floor((now.getTime() - ACTIVITY_RETENTION_MS) / 60_000);
    const res = await platformDb.userRequestActivity.deleteMany({ where: { minute: { lt: before } } });
    return res.count;
  });
  await step("rateLimits", () => deleteExpiredRateLimits(now.getTime()));

  console.log(JSON.stringify({ at: "cron.api-retention", ...counts }));
  return NextResponse.json({ ok: !failed, deleted: counts }, { status: failed ? 500 : 200 });
}
