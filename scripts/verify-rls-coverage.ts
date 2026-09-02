/**
 * The RLS coverage invariant, enforced (SECURITY.md VULN-005).
 *
 * `ALTER DEFAULT PRIVILEGES` grants every future table to the app role, but
 * row-level security is NOT automatic — so the likeliest security regression
 * in this codebase is someone adding a tenant table and forgetting the
 * policy. This script makes that a red build instead of a silent hole:
 *
 *   Every table with an `organizationId` column MUST have
 *     - ROW LEVEL SECURITY enabled,
 *     - FORCE ROW LEVEL SECURITY (so the table owner is bound too),
 *     - at least one policy referencing app.current_org_id,
 *     - a CHECK refusing a blank organizationId.
 *
 * Tables listed in EXEMPT are platform-scoped on purpose and documented here.
 *
 * Run against any environment (staging in CI, prod pre-deploy):
 *   DATABASE_URL=<elevated url> npx tsx scripts/verify-rls-coverage.ts
 */
import { PrismaClient } from "@prisma/client";

// Platform tables that legitimately carry no tenant scoping. Add to this list
// ONLY with a comment saying why the table must be cross-tenant.
const EXEMPT = new Set<string>([
  // (none today — every organizationId table is tenant-scoped)
]);

interface Row {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: number;
  org_policy_count: number;
  blank_check_count: number;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to an ELEVATED connection.");
  const db = new PrismaClient({ datasources: { db: { url } } });

  const rows = await db.$queryRaw<Row[]>`
    SELECT
      c.table_name,
      t.relrowsecurity  AS rls_enabled,
      t.relforcerowsecurity AS rls_forced,
      (SELECT count(*)::int FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.table_name) AS policy_count,
      (SELECT count(*)::int FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.table_name
          AND (p.qual LIKE '%app.current_org_id%' OR p.with_check LIKE '%app.current_org_id%')) AS org_policy_count,
      (SELECT count(*)::int FROM information_schema.check_constraints cc
        JOIN information_schema.constraint_table_usage ctu
          ON cc.constraint_name = ctu.constraint_name AND ctu.table_schema = 'public'
        WHERE ctu.table_name = c.table_name
          AND cc.check_clause LIKE '%organizationId%<>%') AS blank_check_count
    FROM information_schema.columns c
    JOIN pg_class t ON t.relname = c.table_name
    JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organizationId'
      AND t.relkind = 'r'
    ORDER BY c.table_name
  `;

  let bad = 0;
  let checked = 0;
  for (const r of rows) {
    if (EXEMPT.has(r.table_name)) continue;
    checked++;
    const problems: string[] = [];
    if (!r.rls_enabled) problems.push("RLS not enabled");
    if (!r.rls_forced) problems.push("RLS not FORCED (owner bypasses it)");
    if (r.org_policy_count === 0) problems.push("no app.current_org_id policy");
    if (r.blank_check_count === 0) problems.push("no blank-organizationId CHECK");
    if (problems.length > 0) {
      bad++;
      console.log(`✗ ${r.table_name}: ${problems.join("; ")}`);
    }
  }

  console.log(
    `\n${checked} tenant tables checked, ${bad} unprotected` +
      (bad === 0 ? " — every organizationId table is fenced." : ""),
  );
  await db.$disconnect();
  process.exit(bad > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
