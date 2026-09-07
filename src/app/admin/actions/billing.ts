"use server";

/**
 * The workspace's own Awer subscription. Owner/admin only, because it moves
 * this company's money to us.
 *
 * Both actions return a URL rather than redirecting: Stripe is a different
 * origin, and handing the address back lets the caller show an error in place
 * when something is wrong instead of bouncing the user somewhere blank.
 */
import { requireOwnerAdmin } from "@/lib/action-guards";
import { requireOrgId } from "@/lib/org";
import { openBillingPortal, startSubscriptionCheckout } from "@/lib/billing";
import { logActivity } from "@/lib/activity-log";
import type { OrgPlan } from "@prisma/client";
import type { BillingIntervalKey } from "@/lib/plans";

type Result = { ok: true; url: string } | { ok: false; message: string };

function isPlan(v: string): v is OrgPlan {
  return v === "STARTER" || v === "PROFESSIONAL" || v === "ORGANIZATION";
}

export async function startCheckout(input: {
  plan: string;
  interval: string;
}): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  if (!isPlan(input.plan)) return { ok: false, message: "That plan does not exist." };
  const interval: BillingIntervalKey = input.interval === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const orgId = await requireOrgId();
  const res = await startSubscriptionCheckout({ orgId, plan: input.plan, interval });

  if (res.ok) {
    // Recorded on the way OUT, not on success: the workspace changing plan is
    // the fact worth having, and whether they finished paying is Stripe's to
    // tell us through the webhook.
    await logActivity({
      category: "PAYMENT",
      action: "subscription.checkout.opened",
      status: "SUCCESS",
      actorId: guard.userId,
      message: `Opened checkout for the ${input.plan} plan, billed ${interval === "ANNUAL" ? "yearly" : "monthly"}.`,
    });
  }
  return res;
}

export async function openPortal(): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };
  return openBillingPortal(await requireOrgId());
}
