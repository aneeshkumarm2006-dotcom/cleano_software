"use server";

/**
 * Everything the Awer console can change about a customer's account.
 *
 * Rules that hold for every action in this file, without exception:
 *
 *   1. It starts with requirePlatformStaff(), with the minimum role stated.
 *      No action trusts that the page already checked.
 *   2. It writes a PlatformAuditLog row naming who did it and what changed.
 *      The record is written after the change succeeds, in the same request.
 *   3. It refuses to touch Awer's own platform workspace. Suspending ourselves
 *      would lock the console out of the console.
 *   4. It returns a plain result object instead of throwing, so the UI can say
 *      what went wrong rather than showing an error page.
 */
import { revalidatePath } from "next/cache";

import type { OrgPlan } from "@prisma/client";

import { platformDb, recordPlatformAction, requirePlatformStaff } from "@/lib/platform-db";
import { PLANS, trialEndFrom } from "@/lib/plans";
import { PLATFORM_ORG_SLUG } from "@/lib/tenant";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/** How long a trial may be pushed out in one click. Keeps a slip from a typo small. */
const MAX_EXTEND_DAYS = 60;

/** Stored verbatim in the audit log, so it is bounded. */
const MAX_REASON = 300;

/**
 * Allowlists, not `in` checks.
 *
 * Every argument in this file arrives from a browser, and TypeScript's opinion
 * about its type is erased before it gets here. `"__proto__" in PLANS` is true,
 * so an `in` check would let a crafted value through to a lookup that returns
 * something from Object.prototype.
 */
const VALID_PLANS: OrgPlan[] = ["STARTER", "PROFESSIONAL", "ORGANIZATION"];
const VALID_ROLES = ["SUPPORT", "ADMIN", "OWNER"] as const;
type StaffRole = (typeof VALID_ROLES)[number];

async function loadTarget(orgId: string) {
  const org = await platformDb.organization.findUnique({
    where: { id: orgId },
    include: { subscription: true },
  });
  if (!org) return { error: "That workspace no longer exists." as const, org: null };
  if (org.slug === PLATFORM_ORG_SLUG) {
    return { error: "Awer's own workspace cannot be changed from here." as const, org: null };
  }
  return { error: null, org };
}

function refresh(slug: string) {
  revalidatePath("/console");
  revalidatePath("/console/workspaces");
  revalidatePath(`/console/workspaces/${slug}`);
  revalidatePath("/console/billing");
  revalidatePath("/console/trials");
  revalidatePath("/console/audit");
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * Lock a workspace. Everyone there is signed out of their work at once, so it
 * takes an ADMIN and it is recorded with the reason typed at the time.
 */
export async function suspendWorkspace(
  orgId: string,
  reason: string,
): Promise<ActionResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to suspend a workspace." };
  }

  const trimmed = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON) : "";
  if (trimmed.length < 4) {
    return { ok: false, message: "Give a short reason — it is shown in the audit log." };
  }

  const { error, org } = await loadTarget(orgId);
  if (error) return { ok: false, message: error };
  if (org.status === "SUSPENDED") {
    return { ok: false, message: `${org.name} is already suspended.` };
  }

  await platformDb.organization.update({
    where: { id: org.id },
    data: { status: "SUSPENDED" },
  });
  await recordPlatformAction(staff, "org.suspend", { id: org.id, slug: org.slug }, {
    from: org.status,
    reason: trimmed,
  });

  refresh(org.slug);
  return { ok: true, message: `${org.name} is suspended. Nothing was deleted.` };
}

export async function reactivateWorkspace(orgId: string): Promise<ActionResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to reactivate a workspace." };
  }

  const { error, org } = await loadTarget(orgId);
  if (error) return { ok: false, message: error };
  if (org.status === "ACTIVE") {
    return { ok: false, message: `${org.name} is already active.` };
  }

  await platformDb.organization.update({
    where: { id: org.id },
    data: { status: "ACTIVE" },
  });
  await recordPlatformAction(staff, "org.reactivate", { id: org.id, slug: org.slug }, {
    from: org.status,
  });

  refresh(org.slug);
  return { ok: true, message: `${org.name} is active again. Everyone has access back.` };
}

// ---------------------------------------------------------------------------
// Plan and seats
// ---------------------------------------------------------------------------

/**
 * Move a workspace between plans.
 *
 * A downgrade below the current headcount is allowed on purpose: refusing it
 * would leave a company stuck on a plan they no longer want, and the cleaner
 * limit is enforced when they try to ADD someone, not retroactively. The caller
 * is shown what will happen before they confirm.
 */
export async function changePlan(orgId: string, plan: OrgPlan): Promise<ActionResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to change a plan." };
  }

  if (!VALID_PLANS.includes(plan)) return { ok: false, message: "Unknown plan." };

  const { error, org } = await loadTarget(orgId);
  if (error) return { ok: false, message: error };

  const current = org.subscription?.plan ?? org.plan;
  if (current === plan) {
    return { ok: false, message: `${org.name} is already on ${PLANS[plan].label}.` };
  }

  // The plan lives in two places -- on the organization, which the app reads for
  // feature gating, and on the subscription, which billing reads. They must move
  // together or the two disagree about what the customer is paying for.
  await platformDb.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: org.id }, data: { plan } });
    if (org.subscription) {
      await tx.subscription.update({ where: { id: org.subscription.id }, data: { plan } });
    }
  });

  await recordPlatformAction(staff, "plan.change", { id: org.id, slug: org.slug }, {
    from: current,
    to: plan,
  });

  refresh(org.slug);
  return {
    ok: true,
    message: `${org.name} moved from ${PLANS[current].label} to ${PLANS[plan].label}.`,
  };
}

/**
 * Sell a seat count that differs from the plan default — a negotiated deal that
 * would otherwise need its own plan. Clearing it puts the plan default back.
 */
export async function setSeats(orgId: string, seats: number | null): Promise<ActionResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to change seats." };
  }

  if (seats != null && (!Number.isInteger(seats) || seats < 1 || seats > 10_000)) {
    return { ok: false, message: "Seats must be a whole number between 1 and 10,000." };
  }

  const { error, org } = await loadTarget(orgId);
  if (error) return { ok: false, message: error };
  if (!org.subscription) {
    return { ok: false, message: `${org.name} has no subscription to set seats on.` };
  }

  await platformDb.subscription.update({
    where: { id: org.subscription.id },
    data: { seats },
  });
  await recordPlatformAction(staff, "plan.seats", { id: org.id, slug: org.slug }, {
    from: org.subscription.seats,
    to: seats,
  });

  refresh(org.slug);
  return {
    ok: true,
    message:
      seats == null
        ? `${org.name} is back on the ${PLANS[org.subscription.plan].label} seat limit.`
        : `${org.name} now has ${seats} cleaner seats.`,
  };
}

// ---------------------------------------------------------------------------
// Trial
// ---------------------------------------------------------------------------

export async function extendTrial(orgId: string, days: number): Promise<ActionResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to extend a trial." };
  }

  if (!Number.isInteger(days) || days < 1 || days > MAX_EXTEND_DAYS) {
    return { ok: false, message: `Extend by 1 to ${MAX_EXTEND_DAYS} days.` };
  }

  const { error, org } = await loadTarget(orgId);
  if (error) return { ok: false, message: error };

  const sub = org.subscription;
  if (!sub || sub.status !== "TRIALING") {
    return { ok: false, message: `${org.name} is not on a trial.` };
  }

  // Extend from whichever is later: an ended trial should get the full extra
  // days from today, not days that already passed.
  const base = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
  const next = new Date(base);
  next.setDate(next.getDate() + days);

  await platformDb.subscription.update({
    where: { id: sub.id },
    data: { trialEndsAt: next },
  });
  await recordPlatformAction(staff, "trial.extend", { id: org.id, slug: org.slug }, {
    days,
    from: sub.trialEndsAt,
    to: next,
  });

  refresh(org.slug);
  return {
    ok: true,
    message: `${org.name}'s trial now ends ${next.toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric" })}.`,
  };
}

/**
 * Put a workspace back on a fresh trial. Used when a company asks to restart
 * after a lapse rather than being billed for the gap.
 */
export async function restartTrial(orgId: string): Promise<ActionResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to restart a trial." };
  }

  const { error, org } = await loadTarget(orgId);
  if (error) return { ok: false, message: error };
  if (!org.subscription) {
    return { ok: false, message: `${org.name} has no subscription.` };
  }
  if (org.subscription.status === "TRIALING") {
    return { ok: false, message: `${org.name} is already on a trial.` };
  }

  const ends = trialEndFrom(new Date());
  await platformDb.subscription.update({
    where: { id: org.subscription.id },
    data: { status: "TRIALING", trialEndsAt: ends },
  });
  await recordPlatformAction(staff, "trial.restart", { id: org.id, slug: org.slug }, {
    from: org.subscription.status,
    endsAt: ends,
  });

  refresh(org.slug);
  return { ok: true, message: `${org.name} is on a fresh trial.` };
}

// ---------------------------------------------------------------------------
// Awer's own staff
// ---------------------------------------------------------------------------

/**
 * Grant, change or revoke platform access.
 *
 * OWNER only, and nobody can act on their own account: raising your own role, or
 * removing the last owner, would each leave the console in a state only a
 * database edit could fix.
 */
export async function setStaffRole(
  userId: string,
  role: StaffRole | null,
): Promise<ActionResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("OWNER");
  } catch {
    return { ok: false, message: "Only a platform owner can change staff access." };
  }

  if (role !== null && !VALID_ROLES.includes(role)) {
    return { ok: false, message: "Unknown role." };
  }
  if (userId === staff.id) {
    return { ok: false, message: "You cannot change your own access. Ask another owner." };
  }

  // organizationId is a plain indexed column rather than a Prisma relation --
  // adding a foreign key to 97 tables would have validated every existing row on
  // a live database -- so the platform workspace is looked up by slug and the
  // ids compared directly.
  const [user, platformOrg] = await Promise.all([
    platformDb.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, platformRole: true, organizationId: true },
    }),
    platformDb.organization.findUnique({
      where: { slug: PLATFORM_ORG_SLUG },
      select: { id: true },
    }),
  ]);
  if (!user) return { ok: false, message: "That account no longer exists." };

  // Platform access only ever belongs to an account in Awer's own workspace.
  //
  // Without this, a mistyped or guessed id could hand the keys to every customer
  // on Awer to a cleaner's or a customer's login -- an account nobody at Awer
  // controls. Staff get an account in the platform workspace first, and a role
  // second.
  if (!platformOrg || user.organizationId !== platformOrg.id) {
    return {
      ok: false,
      message:
        "That account is not in Awer's own workspace, so it cannot be given platform access.",
    };
  }

  if (user.platformRole === "OWNER" && role !== "OWNER") {
    const owners = await platformDb.user.count({
      where: { platformRole: "OWNER", deletedAt: null },
    });
    if (owners <= 1) {
      return { ok: false, message: "That is the last platform owner. Promote someone else first." };
    }
  }

  await platformDb.user.update({ where: { id: user.id }, data: { platformRole: role } });
  await recordPlatformAction(staff, role ? "staff.role" : "staff.revoke", undefined, {
    userId: user.id,
    email: user.email,
    from: user.platformRole,
    to: role,
  });

  revalidatePath("/console/staff");
  revalidatePath("/console/audit");
  return {
    ok: true,
    message: role
      ? `${user.name} is now ${role.toLowerCase()}.`
      : `${user.name} no longer has platform access.`,
  };
}
