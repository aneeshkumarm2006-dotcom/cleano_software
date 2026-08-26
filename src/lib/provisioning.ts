/**
 * Turning a signup into a working workspace.
 *
 * Runs with the platform client, because at this point there is no tenant to
 * scope to -- the tenant is what is being created. Everything happens in one
 * transaction, so a half-made workspace cannot exist: either the organization,
 * its subscription and its first owner all appear, or none of them do.
 */
import { hashPassword } from "better-auth/crypto";
import type { OrgPlan } from "@prisma/client";

import { platformDb } from "@/lib/platform-db";
import { PLANS, trialEndFrom } from "@/lib/plans";
import { isValidOrgSlug } from "@/lib/tenant";

export class ProvisioningError extends Error {
  constructor(readonly code: "slug-taken" | "slug-invalid" | "email-taken" | "plan-not-self-serve", message: string) {
    super(message);
    this.name = "ProvisioningError";
  }
}

export interface ProvisionInput {
  slug: string;
  companyName: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
  plan: OrgPlan;
  timezone?: string;
  /** Set when Awer staff create the workspace themselves, bypassing self-serve. */
  createdByStaff?: boolean;
}

export interface ProvisionResult {
  organizationId: string;
  slug: string;
  ownerId: string;
  trialEndsAt: Date;
}

/** Turn a company name into a candidate subdomain. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);
}

/**
 * A free slug near the one asked for, so signup does not dead-end.
 *
 * One query, not one per candidate. Every candidate shares the same prefix, so
 * the taken ones can be fetched together and the choice made in memory. The
 * per-candidate version was fine when only a script called this; it is now
 * reachable from an unauthenticated signup form, where turning one request into
 * fifty database round-trips is an amplification worth not having.
 */
export async function findFreeSlug(desired: string): Promise<string> {
  const base = slugify(desired) || "workspace";

  const taken = new Set(
    (
      await platformDb.organization.findMany({
        where: { slug: { startsWith: base } },
        select: { slug: true },
      })
    ).map((o) => o.slug),
  );

  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!isValidOrgSlug(candidate)) continue;
    if (!taken.has(candidate)) return candidate;
  }
  throw new ProvisioningError("slug-taken", "Could not find a free address.");
}

export async function provisionOrganization(
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const slug = slugify(input.slug);
  if (!isValidOrgSlug(slug)) {
    throw new ProvisioningError("slug-invalid", `"${slug}" cannot be used as an address.`);
  }
  if (!PLANS[input.plan].selfServe && !input.createdByStaff) {
    throw new ProvisioningError(
      "plan-not-self-serve",
      `${PLANS[input.plan].label} is arranged with us rather than signed up for.`,
    );
  }

  const email = input.ownerEmail.trim().toLowerCase();
  const now = new Date();
  const trialEndsAt = trialEndFrom(now);
  const password = await hashPassword(input.password);

  return platformDb.$transaction(async (tx) => {
    const clash = await tx.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (clash) {
      throw new ProvisioningError("slug-taken", `"${slug}" is already taken.`);
    }

    const org = await tx.organization.create({
      data: {
        slug,
        name: input.companyName.trim(),
        // ACTIVE immediately: the trial is a subscription state, not a reason to
        // withhold the product. A workspace nobody can open converts nobody.
        status: "ACTIVE",
        plan: input.plan,
        timezone: input.timezone?.trim() || "America/Toronto",
      },
    });

    await tx.subscription.create({
      data: {
        organizationId: org.id,
        plan: input.plan,
        status: "TRIALING",
        trialEndsAt,
      },
    });

    // Unique per organization, so this only clashes within the new workspace --
    // which is empty. Checked anyway, because the first owner of a workspace
    // failing to be created is not a failure worth discovering later.
    const existing = await tx.user.findFirst({
      where: { organizationId: org.id, email },
      select: { id: true },
    });
    if (existing) {
      throw new ProvisioningError("email-taken", `${email} is already in use here.`);
    }

    const owner = await tx.user.create({
      data: {
        organizationId: org.id,
        name: input.ownerName.trim(),
        email,
        role: "OWNER",
        emailVerified: false,
        isActive: true,
      },
    });

    await tx.account.create({
      data: {
        userId: owner.id,
        accountId: owner.id,
        providerId: "credential",
        password,
      },
    });

    return {
      organizationId: org.id,
      slug: org.slug,
      ownerId: owner.id,
      trialEndsAt,
    };
  });
}
