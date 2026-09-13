/**
 * Read-only lookup so browser testing can pick a real workspace host and a real
 * login instead of guessing. SELECTs only — this file must never write.
 *
 *   npx tsx scripts/read-only-lookup.ts
 *
 * It deliberately prints no password hashes and no customer PII beyond the
 * staff email addresses needed to sign in.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orgs: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
    `select o.slug,
            o.name,
            (select count(*) from "User" u where u."organizationId" = o.id) as users
       from "Organization" o
      order by o.slug`,
  );
  console.log("=== ORGANIZATIONS ===");
  for (const o of orgs) console.log(`  ${o.slug}\t${o.name}\t(${o.users} users)`);

  const staff: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
    `select o.slug as org, u.role, u."platformRole", u.email, u.name, u."lastSeenAt"
       from "User" u
       join "Organization" o on o.id = u."organizationId"
      where u.role not in ('CLIENT', 'APPLICANT')
      order by o.slug, u.role, u.email
      limit 100`,
  );
  console.log("\n=== STAFF / NON-CUSTOMER ACCOUNTS ===");
  for (const u of staff) {
    console.log(
      `  ${u.org}\t${u.role}\t${u.platformRole ?? "-"}\t${u.email}\t${u.name}\tlastSeen=${u.lastSeenAt ?? "never"}`,
    );
  }
}

main()
  .catch((e) => console.error("ERR", e.message))
  .finally(() => prisma.$disconnect());
