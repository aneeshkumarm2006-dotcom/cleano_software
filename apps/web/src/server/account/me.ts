// Who is signed in, and for which company (GET /api/v1/me).
import "server-only";

import type { MeResponse } from "@bookmops/api/v1";

import type { OrgContext } from "@/lib/org-context";
import { db } from "@/lib/org-db";
import { getSetting } from "@/lib/settings";

import type { Actor } from "../actor";
import { notFound, ok, type Result } from "../result";

export async function meFor(actor: Actor, org: OrgContext): Promise<Result<MeResponse>> {
  const person = await db.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, name: true, email: true, role: true, mustChangePassword: true },
  });
  if (!person) return notFound();
  const currency = await getSetting("general.currency");
  return ok({
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      role: person.role as MeResponse["person"]["role"],
    },
    company: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      timezone: org.timezone,
      currency: typeof currency === "string" && currency ? currency : "CAD",
    },
    mustChangePassword: person.mustChangePassword,
  });
}
