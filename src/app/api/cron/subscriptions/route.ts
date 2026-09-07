import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/cron-auth";
import { platformDb } from "@/lib/platform-db";
import { runAsOrg } from "@/lib/org-context";
import { logActivity } from "@/lib/activity-log";
import { sendTrialEnding } from "@/lib/email";
import { PLANS } from "@/lib/plans";

/**
 * The nightly pass over Awer's own subscriptions.
 *
 * Until this existed, trialEndsAt was written at signup and read by nothing:
 * a company could trial for thirty days and then use the platform free
 * forever, and nobody would be told.
 *
 * Two jobs, and deliberately no third:
 *   1. warn a workspace once, a week out, that its trial is ending
 *   2. mark a trial that has run out with no card as PAST_DUE
 *
 * It does NOT switch anyone off. No code anywhere gates access on subscription
 * status today, and quietly making one do so from inside a cron is not a
 * decision a nightly job should take on a live customer's behalf. PAST_DUE
 * here means "we need to talk", and it shows up in the console and in the
 * workspace's own log.
 *
 * vercel.json: { "path": "/api/cron/subscriptions", "schedule": "0 14 * * *" }
 */

/** How far ahead of the end of a trial the single warning goes out. */
const WARN_DAYS = 7;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const warnCutoff = new Date(now.getTime() + WARN_DAYS * 24 * 60 * 60 * 1000);
  const counts = { warned: 0, expired: 0, failed: 0 };

  // Subscriptions are platform rows, so this reads across workspaces rather
  // than through forEachOrganization. Org context is entered per workspace
  // below, only where an email or a log row needs it.
  const rows = await platformDb.subscription.findMany({
    where: {
      status: "TRIALING",
      stripeSubscriptionId: null,
      trialEndsAt: { not: null, lte: warnCutoff },
      organization: { status: "ACTIVE" },
    },
    select: {
      id: true,
      plan: true,
      trialEndsAt: true,
      trialReminderSentAt: true,
      organization: { select: { id: true, slug: true, name: true, timezone: true } },
    },
  });

  for (const row of rows) {
    const org = row.organization;
    const endsAt = row.trialEndsAt!;
    const expired = endsAt.getTime() <= now.getTime();

    try {
      if (expired) {
        // Out of trial with no card. Say so plainly and stop counting them as
        // a live trial, so the console's trial list means what it says.
        await platformDb.subscription.update({
          where: { id: row.id },
          data: { status: "PAST_DUE" },
        });
        await runAsOrg(org, () =>
          logActivity({
            category: "PAYMENT",
            action: "subscription.trial.expired",
            status: "FAILED",
            message:
              "The Awer free trial has ended and no payment method is on file. Choose a plan in Settings, Plan & Billing.",
          }),
        ).catch(() => {});
        counts.expired++;
        continue;
      }

      // Still inside the trial: one warning, ever.
      if (row.trialReminderSentAt) continue;

      const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      await runAsOrg(org, () =>
        sendTrialEnding({ daysLeft, planLabel: PLANS[row.plan].label }),
      );
      // Stamped only after the send returned, so a failure retries tomorrow
      // rather than silently using up the one warning we get.
      await platformDb.subscription.update({
        where: { id: row.id },
        data: { trialReminderSentAt: now },
      });
      counts.warned++;
    } catch (e) {
      console.error(`[billing] trial pass failed for ${org.slug}`, e);
      counts.failed++;
    }
  }

  return NextResponse.json({ ok: true, ...counts, considered: rows.length });
}
