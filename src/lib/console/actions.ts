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
import { randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";

import { revalidatePath } from "next/cache";

import type { OrgPlan } from "@prisma/client";

import { platformDb, recordPlatformAction, requirePlatformStaff } from "@/lib/platform-db";
import { PLANS, trialEndFrom } from "@/lib/plans";
import { ProvisioningError, provisionOrganization, slugify } from "@/lib/provisioning";
import { PLATFORM_ORG_SLUG, isValidOrgSlug, originForSlug } from "@/lib/tenant";
import { sendWorkspaceCredentials } from "@/lib/platform-email";

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
// Access requests
// ---------------------------------------------------------------------------

/**
 * A first password for a workspace created on someone's behalf.
 *
 * Random, shown to the staff member once, stored only as a hash, and paired with
 * mustChangePassword so the owner replaces it the first time they sign in. A
 * memorable password chosen by whoever is on shift would be the same password
 * for every customer.
 */
function temporaryPassword(): string {
  return `awer-${randomBytes(9).toString("base64url")}`;
}

export type ApproveResult =
  | {
      ok: true;
      message: string;
      slug: string;
      email: string;
      password: string;
      /**
       * Whether the credentials email actually went out. Reported rather than
       * assumed: the password is still shown on screen, and staff need to know
       * whether they have to pass it on by hand.
       */
      emailed?: boolean;
      emailError?: string;
    }
  | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Creating a workspace
// ---------------------------------------------------------------------------

export interface CreateWorkspaceInput {
  companyName: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  plan: string;
  timezone?: string;
}

/** Longest any single field may be. Everything here ends up in a database row. */
const MAX_FIELD = 120;

/**
 * Create a workspace outright, with no request behind it.
 *
 * The other two ways in both start with the company: they sign themselves up at
 * /get-started, or they ask for the Organization tier and someone approves it.
 * This is the third — Awer staff creating a workspace for a company that never
 * filled anything in, which is what onboarding a customer won over the phone
 * actually looks like.
 *
 * It is deliberately the same machinery as an approval rather than a second
 * copy of it: one provisionOrganization call, one transaction, the same
 * one-time password, the same forced change on first sign-in. The only thing
 * that differs is that there is no AccessRequest row to mark decided.
 *
 * `createdByStaff` is what lets the Organization plan through — that tier is
 * not self-serve on purpose, and this is a sanctioned way past that, so it
 * takes an ADMIN and it is written to the audit log like every other action
 * here.
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<ApproveResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to create a workspace." };
  }

  const companyName = String(input?.companyName ?? "").trim().slice(0, MAX_FIELD);
  const ownerName = String(input?.ownerName ?? "").trim().slice(0, MAX_FIELD);
  const ownerEmail = String(input?.ownerEmail ?? "").trim().toLowerCase().slice(0, MAX_FIELD);
  const timezone = String(input?.timezone ?? "").trim().slice(0, MAX_FIELD);
  const plan = String(input?.plan ?? "") as OrgPlan;

  if (companyName.length < 2) {
    return { ok: false, message: "Give the company's name." };
  }
  if (ownerName.length < 2) {
    return { ok: false, message: "Give the owner's name — it is who the account belongs to." };
  }
  // Deliberately loose, matching signup: address syntax is a poor test of
  // whether an address works, and this one is typed by staff who can see it.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return { ok: false, message: "That email address does not look right." };
  }
  // Allowlist rather than `in`, for the reason given at the top of this file.
  if (!VALID_PLANS.includes(plan)) {
    return { ok: false, message: "Pick a plan." };
  }

  const slug = slugify(input?.slug || companyName);
  if (!isValidOrgSlug(slug)) {
    return { ok: false, message: `"${slug}" cannot be used as an address.` };
  }

  const password = temporaryPassword();

  try {
    const created = await provisionOrganization({
      slug,
      companyName,
      ownerName,
      ownerEmail,
      password,
      plan,
      timezone: timezone || undefined,
      // Staff are doing this on the company's behalf, so the self-serve gate on
      // the Organization tier does not apply.
      createdByStaff: true,
    });

    // They did not choose this password, so they must replace it. Same reasoning
    // as an approval: a company that signs itself up chose its own and is not
    // asked to change it.
    await platformDb.user.update({
      where: { id: created.ownerId },
      data: { mustChangePassword: true },
    });

    await recordPlatformAction(
      staff,
      "org.create",
      { id: created.organizationId, slug: created.slug },
      { company: companyName, email: ownerEmail, plan, owner: ownerName },
    );

    // Sent, not just shown. The on-screen copy is seen once by whoever pressed
    // the button; the owner needs it themselves, and a workspace whose password
    // lives only in a browser tab is one lost tab away from being unreachable.
    // Never allowed to fail the creation — the workspace exists either way, and
    // the result says whether the email got out so staff can pass it on by hand.
    const mail = await sendWorkspaceCredentials({
      to: ownerEmail,
      ownerName,
      companyName,
      origin: originForSlug(created.slug),
      password,
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "send failed" }));

    refresh(created.slug);
    revalidatePath("/console/requests");

    return {
      ok: true,
      message: `${companyName} is live at ${created.slug}.`,
      slug: created.slug,
      email: ownerEmail,
      password,
      emailed: mail.ok,
      emailError: mail.ok ? undefined : mail.error,
    };
  } catch (e) {
    if (e instanceof ProvisioningError) return { ok: false, message: e.message };
    console.error("create workspace failed", e);
    return { ok: false, message: "Could not create the workspace. Nothing was changed." };
  }
}

/**
 * Issue the owner a new password and email it to them.
 *
 * The gap this closes. A staff-created workspace's password was generated once,
 * shown once on the screen of whoever pressed the button, and stored only as a
 * hash. Navigate away and it was gone — and there was nothing behind it: the
 * console had no reset, "Forgot password?" on the staff sign-in says "contact
 * your administrator" (which an OWNER does not have), and signing in as the
 * customer is not built. One lost browser tab left a workspace we had just sold
 * permanently unreachable. That happened, to CleanoCalgary, which is what
 * prompted this.
 *
 * ADMIN, and audited like every other action here: handing somebody the keys to
 * a customer's account is exactly the sort of thing the log exists to record.
 * The new password is emailed AND returned, for the same reason creation does
 * both — the address may not be reachable yet, and staff need to know.
 */
export async function resendOwnerCredentials(orgId: string): Promise<ApproveResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to reset a password." };
  }

  const { error, org } = await loadTarget(orgId);
  if (error) return { ok: false, message: error };

  // The FIRST owner, not any owner. A workspace can grow a second one, and the
  // account this is meant to rescue is the one provisioning created.
  const owner = await platformDb.user.findFirst({
    where: { organizationId: org.id, role: "OWNER", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true },
  });
  if (!owner) {
    return { ok: false, message: `${org.name} has no owner account to reset.` };
  }

  const password = temporaryPassword();
  const hashed = await hashPassword(password);

  try {
    await platformDb.$transaction(async (tx) => {
      // Upsert rather than update: an owner who has only ever signed in another
      // way has no credential row, and this is precisely the moment to give
      // them one rather than to fail.
      const account = await tx.account.findFirst({
        where: { userId: owner.id, providerId: "credential" },
        select: { id: true },
      });
      if (account) {
        await tx.account.update({ where: { id: account.id }, data: { password: hashed } });
      } else {
        await tx.account.create({
          data: {
            userId: owner.id,
            accountId: owner.id,
            providerId: "credential",
            password: hashed,
          },
        });
      }
      // They did not choose it, so it buys one sign-in and no more.
      await tx.user.update({
        where: { id: owner.id },
        data: { mustChangePassword: true },
      });
    });
  } catch (e) {
    console.error("resend owner credentials failed", e);
    return { ok: false, message: "Could not reset the password. Nothing was changed." };
  }

  const mail = await sendWorkspaceCredentials({
    to: owner.email,
    ownerName: owner.name,
    companyName: org.name,
    origin: originForSlug(org.slug),
    password,
    reissued: true,
  }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "send failed" }));

  // Recorded WITHOUT the password. The audit log is read by more people than
  // may sign in as this customer, and a log that leaks credentials is worse
  // than the problem it documents.
  await recordPlatformAction(
    staff,
    "org.owner.password_reset",
    { id: org.id, slug: org.slug },
    { owner: owner.email, emailed: mail.ok },
  );

  refresh(org.slug);

  return {
    ok: true,
    message: mail.ok
      ? `New password sent to ${owner.email}.`
      : `New password set. The email did not go out — pass it on yourself.`,
    slug: org.slug,
    email: owner.email,
    password,
    emailed: mail.ok,
    emailError: mail.ok ? undefined : mail.error,
  };
}

/**
 * Approve a request and create the workspace it asked for.
 *
 * One action rather than two, because "approved" and "has a workspace" drifting
 * apart is the failure that leaves a customer waiting on something everyone
 * believes already happened.
 */
export async function approveAccessRequest(
  id: string,
  slugInput: string,
): Promise<ApproveResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to approve a request." };
  }

  const req = await platformDb.accessRequest.findUnique({ where: { id } });
  if (!req) return { ok: false, message: "That request no longer exists." };
  if (req.status !== "PENDING") {
    return { ok: false, message: `That request was already ${req.status.toLowerCase()}.` };
  }

  const slug = slugify(slugInput || req.wantedSlug || req.companyName);
  if (!isValidOrgSlug(slug)) {
    return { ok: false, message: `"${slug}" cannot be used as an address.` };
  }

  const password = temporaryPassword();

  try {
    const created = await provisionOrganization({
      slug,
      companyName: req.companyName,
      ownerName: req.contactName,
      ownerEmail: req.email,
      password,
      plan: "ORGANIZATION",
      // The Organization tier is not self-serve; this is the sanctioned way in.
      createdByStaff: true,
    });

    await platformDb.$transaction(async (tx) => {
      // They did not choose this password, so they must replace it. The flag is
      // set here rather than inside provisioning because a company that signs
      // itself up chose its own and should not be asked to change it.
      await tx.user.update({
        where: { id: created.ownerId },
        data: { mustChangePassword: true },
      });
      await tx.accessRequest.update({
        where: { id: req.id },
        data: {
          status: "APPROVED",
          createdOrgId: created.organizationId,
          decidedById: staff.id,
          decidedByEmail: staff.email,
          decidedAt: new Date(),
        },
      });
    });

    await recordPlatformAction(
      staff,
      "request.approve",
      { id: created.organizationId, slug: created.slug },
      { requestId: req.id, company: req.companyName, email: req.email },
    );

    // Same reasoning as createWorkspace: a password that exists only on the
    // approver's screen is one closed tab away from an unreachable workspace.
    const mail = await sendWorkspaceCredentials({
      to: req.email,
      ownerName: req.contactName,
      companyName: req.companyName,
      origin: originForSlug(created.slug),
      password,
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "send failed" }));

    revalidatePath("/console/requests");
    revalidatePath("/console/workspaces");
    revalidatePath("/console");
    revalidatePath("/console/audit");

    return {
      ok: true,
      message: `${req.companyName} is live at ${created.slug}.`,
      slug: created.slug,
      email: req.email,
      password,
      emailed: mail.ok,
      emailError: mail.ok ? undefined : mail.error,
    };
  } catch (e) {
    if (e instanceof ProvisioningError) return { ok: false, message: e.message };
    console.error("approve request failed", e);
    return { ok: false, message: "Could not create the workspace. Nothing was changed." };
  }
}

export async function declineAccessRequest(
  id: string,
  note: string,
): Promise<ActionResult> {
  let staff;
  try {
    staff = await requirePlatformStaff("ADMIN");
  } catch {
    return { ok: false, message: "You do not have permission to decline a request." };
  }

  const trimmed = typeof note === "string" ? note.trim().slice(0, MAX_REASON) : "";
  if (trimmed.length < 4) {
    return { ok: false, message: "Say why, briefly. It is what you will read next time." };
  }

  const req = await platformDb.accessRequest.findUnique({ where: { id } });
  if (!req) return { ok: false, message: "That request no longer exists." };
  if (req.status !== "PENDING") {
    return { ok: false, message: `That request was already ${req.status.toLowerCase()}.` };
  }

  await platformDb.accessRequest.update({
    where: { id: req.id },
    data: {
      status: "DECLINED",
      decisionNote: trimmed,
      decidedById: staff.id,
      decidedByEmail: staff.email,
      decidedAt: new Date(),
    },
  });

  await recordPlatformAction(staff, "request.decline", undefined, {
    requestId: req.id,
    company: req.companyName,
    email: req.email,
    reason: trimmed,
  });

  revalidatePath("/console/requests");
  revalidatePath("/console/audit");
  return {
    ok: true,
    message: `${req.companyName} marked as declined. Nothing was sent to them — write to them yourself.`,
  };
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
