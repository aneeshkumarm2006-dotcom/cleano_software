/**
 * Making a maintenance script say which company it is for.
 *
 * These scripts were written when there was one company, so they say things
 * like `db.job.updateMany({ where: { status: "COMPLETED" } })` and mean "all of
 * them", which was true. It is not true any more. Run unchanged against a
 * multi-tenant database, a backfill written to repair one company's rows now
 * edits every company's rows, and nothing about the command line hints at it.
 *
 * Rewriting two dozen mostly-historical scripts to be tenant-aware would be a
 * lot of edits to code that has already done its job. So the first move is
 * cheaper and stops the whole class: a script that has not been TOLD which
 * company it is for refuses to run.
 *
 *   npx tsx scripts/thing.ts --org teamcleano   # that company
 *   npx tsx scripts/thing.ts --all-orgs         # every company, said out loud
 *   npx tsx scripts/thing.ts                    # refused, with an explanation
 *
 * `--all-orgs` is not a loophole. It is the same instruction, typed on purpose,
 * where it will show up in a shell history and a screen share.
 */
import { PrismaClient } from "@prisma/client";

export type ScriptScope =
  | { mode: "one"; organizationId: string; slug: string }
  | { mode: "all"; organizationIds: string[] };

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Is this database multi-tenant yet? Before the cutover, nothing to enforce. */
async function isMultiTenant(db: PrismaClient): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'organizationId'`;
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function requireScriptScope(db: PrismaClient): Promise<ScriptScope> {
  if (!(await isMultiTenant(db))) {
    // Single-tenant database: the old behaviour is still the correct one, and
    // demanding a flag would only break scripts against an old backup.
    return { mode: "all", organizationIds: [] };
  }

  const slug = flag("org");
  if (slug) {
    const org = await db.organization.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      select: { id: true, slug: true },
    });
    if (!org) {
      const known = await db.organization.findMany({ select: { slug: true }, orderBy: { slug: "asc" } });
      throw new Error(
        `No workspace "${slug}". Known: ${known.map((o) => o.slug).join(", ")}`,
      );
    }
    return { mode: "one", organizationId: org.id, slug: org.slug };
  }

  if (has("all-orgs")) {
    const orgs = await db.organization.findMany({ select: { id: true }, orderBy: { slug: "asc" } });
    return { mode: "all", organizationIds: orgs.map((o) => o.id) };
  }

  const orgs = await db.organization.findMany({ select: { slug: true }, orderBy: { slug: "asc" } });
  throw new Error(
    `This database now holds ${orgs.length} companies, and this script does not say which one it is for.\n` +
      `  Known workspaces: ${orgs.map((o) => o.slug).join(", ")}\n\n` +
      `  Re-run with   --org <slug>    to act on one company, or\n` +
      `                --all-orgs      to act on every company, deliberately.`,
  );
}

/** A `where` fragment that narrows to the chosen scope. Spread into any query. */
export function scopeWhere(scope: ScriptScope): Record<string, unknown> {
  return scope.mode === "one" ? { organizationId: scope.organizationId } : {};
}

/** One line for a script to print, so the log says what it acted on. */
export function describeScope(scope: ScriptScope): string {
  return scope.mode === "one"
    ? `scope: ${scope.slug} only`
    : `scope: ALL ${scope.organizationIds.length} companies (--all-orgs)`;
}

/**
 * For a script that has NOT been made tenant-aware: refuse outright.
 *
 * The tempting shortcut is to let these accept `--org` and print the slug back.
 * That is worse than no guard at all — the operator reads "scope: teamcleano",
 * believes it, and the unmodified queries underneath still edit every company.
 * A guard that lies is how you get a confident mistake.
 *
 * So an unconverted script stops, names itself, and says what converting it
 * means. Most of these are historical repairs that already ran once against a
 * single-company database and will never be needed again; the honest thing is
 * to leave them alone and locked rather than half-fix two dozen files.
 */
export async function refuseOnMultiTenant(db: PrismaClient, script: string): Promise<void> {
  if (!(await isMultiTenant(db))) return; // pre-cutover database: still correct

  const orgs = await db.organization.findMany({ select: { slug: true }, orderBy: { slug: "asc" } });
  throw new Error(
    `${script} has not been made tenant-aware, and this database holds ${orgs.length} companies ` +
      `(${orgs.map((o) => o.slug).join(", ")}).\n\n` +
      `  Its queries do not name a company, so running it would act on ALL of them.\n` +
      `  Most scripts here are one-off repairs that already ran against the old\n` +
      `  single-company database and are kept for the record.\n\n` +
      `  To use it again: give its queries an organizationId (see scopeWhere in\n` +
      `  scripts/_scope.ts) and swap this call for requireScriptScope().`,
  );
}
