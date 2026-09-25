// "I forgot my password", from a phone that doesn't know its company yet
// (API_V1.md §2).
//
// Discovery needs the password, so the app can't know which company to reset
// against. Instead the platform host emails a reset link for every workspace
// the address belongs to, and always answers the same, so the answer says
// nothing about the address.
//
// Each reset is Better Auth's own, run inside that company's context: the
// token, the link on the company's own address, the email, and the rule that a
// completed reset ends every session are exactly what the web's
// forgot-password page does. The sends happen after the response has gone, so
// the time taken says nothing either.
import "server-only";

import { auth } from "@/lib/auth";
import { runAsOrg } from "@/lib/org-context";
import { platformDb } from "@/lib/platform-db";
import { rateLimitHit } from "@/lib/rate-limit";
import { PLATFORM_ORG_SLUG } from "@/lib/tenant";

import { effect, type Effect } from "../effects";

/** Per email: a person asking twice is normal; twenty times is not. */
const PER_EMAIL = { max: 3, windowMs: 60 * 60_000 };
/** Per address, with a crew on one carrier address in mind. */
const PER_IP = { max: 20, windowMs: 10 * 60_000 };

/**
 * The resets to send, as effects. Returns none when limited or when the
 * address has no account, and the caller answers the same either way.
 */
export async function forgotPasswordEffects(emailRaw: string, ip: string): Promise<Effect[]> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return [];
  if (rateLimitHit("v1:forgot:ip", ip, PER_IP)) return [];
  if (rateLimitHit("v1:forgot:email", email, PER_EMAIL)) return [];

  const orgs = await platformDb.organization.findMany({
    where: { status: "ACTIVE", slug: { not: PLATFORM_ORG_SLUG } },
    select: { id: true, slug: true, name: true, timezone: true },
  });
  const byId = new Map(orgs.map((o) => [o.id, o]));

  const users = await platformDb.user.findMany({
    where: {
      email,
      isActive: true,
      deletedAt: null,
      organizationId: { in: orgs.map((o) => o.id) },
      accounts: { some: { providerId: "credential" } },
    },
    select: { organizationId: true },
    take: 10,
  });

  const targets = users.flatMap((u) => {
    const org = byId.get(u.organizationId);
    return org ? [org] : [];
  });

  return targets.map((org) =>
    effect("v1 forgot-password reset", () =>
      runAsOrg(org, () =>
        auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } }),
      ),
    ),
  );
}
