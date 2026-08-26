/**
 * Create the platform workspace and its first Awer staff account.
 *
 *   npx tsx scripts/seed-platform.ts --email you@awer.com --name "Your Name"
 *
 * Deliberately not routed through provisionOrganization(): "platform" is a
 * reserved slug precisely so no customer can claim it, and this is not a
 * customer. It has no subscription and is never billed.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import { PLATFORM_ORG_SLUG } from "../src/lib/tenant";

const db = new PrismaClient();

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v && fallback === undefined) throw new Error(`missing --${name}`);
  return v ?? fallback!;
}

(async () => {
  const email = arg("email").trim().toLowerCase();
  const name = arg("name");
  const password = arg("password", "PlatformPass123!");

  const org =
    (await db.organization.findUnique({ where: { slug: PLATFORM_ORG_SLUG } })) ??
    (await db.organization.create({
      data: {
        slug: PLATFORM_ORG_SLUG,
        name: "Awer",
        status: "ACTIVE",
        plan: "ORGANIZATION",
      },
    }));
  console.log(`platform workspace: ${org.slug} (${org.id})`);

  const existing = await db.user.findFirst({
    where: { organizationId: org.id, email },
  });
  if (existing) {
    await db.user.update({
      where: { id: existing.id },
      data: { platformRole: "OWNER", isActive: true },
    });
    console.log(`existing staff account promoted: ${email}`);
    return;
  }

  const user = await db.user.create({
    data: {
      organizationId: org.id,
      name,
      email,
      role: "OWNER",
      platformRole: "OWNER",
      emailVerified: true,
      isActive: true,
    },
  });
  await db.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword(password),
    },
  });
  console.log(`staff account created: ${email} / ${password}`);
  console.log(`sign in at ${PLATFORM_ORG_SLUG}.useawer.com`);
})().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
