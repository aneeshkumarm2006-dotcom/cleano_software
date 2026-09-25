/**
 * End the sessions of people who were switched off or archived before
 * switching someone off started ending their sessions.
 *
 * From this release, switching someone off (or archiving them) deletes their
 * sessions at the moment it happens, and customSession treats them as signed
 * out on every page and action. What neither does is delete a session row
 * minted BEFORE the release for someone who was already switched off. Those
 * rows still answer better-auth's own endpoints (/api/auth/*), which read the
 * session without going through customSession. This removes them, once.
 *
 *   npx tsx scripts/endSwitchedOffSessions.ts --all-orgs            # dry run: counts only
 *   npx tsx scripts/endSwitchedOffSessions.ts --all-orgs --apply    # deletes
 *   npx tsx scripts/endSwitchedOffSessions.ts --org teamcleano --apply
 *
 * Needs the elevated connection (PLATFORM_DATABASE_URL, or a DATABASE_URL that
 * bypasses row-level security), because it reads users across companies.
 * Idempotent: a second run finds nothing.
 */
import { PrismaClient } from "@prisma/client";

import { describeScope, requireScriptScope, scopeWhere } from "./_scope";

const db = new PrismaClient({
  datasourceUrl: process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL,
});
const APPLY = process.argv.includes("--apply");

async function main() {
  const scope = await requireScriptScope(db);

  const switchedOff = await db.user.findMany({
    where: {
      ...scopeWhere(scope),
      OR: [{ isActive: false }, { deletedAt: { not: null } }],
      sessions: { some: {} },
    },
    select: {
      id: true,
      role: true,
      organizationId: true,
      _count: { select: { sessions: true } },
    },
  });

  const sessions = switchedOff.reduce((n, u) => n + u._count.sessions, 0);
  const byRole = new Map<string, number>();
  for (const u of switchedOff) byRole.set(u.role, (byRole.get(u.role) ?? 0) + u._count.sessions);

  console.log(`Scope: ${describeScope(scope)}`);
  console.log(`Switched-off or archived people still holding sessions: ${switchedOff.length}`);
  console.log(`Sessions to end: ${sessions}`);
  for (const [role, n] of [...byRole].sort()) console.log(`  ${role.padEnd(12)} ${n}`);

  if (!APPLY) {
    console.log("\nDry run. Nothing was changed. Re-run with --apply to end these sessions.");
    return;
  }
  if (switchedOff.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  const res = await db.session.deleteMany({
    where: { userId: { in: switchedOff.map((u) => u.id) } },
  });
  console.log(`\nEnded ${res.count} session${res.count === 1 ? "" : "s"}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
