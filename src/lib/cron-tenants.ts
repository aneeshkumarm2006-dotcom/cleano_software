import "server-only";

import { db as rawDb } from "@/db";
import { scopedTo, type ScopedDb } from "@/lib/db-scoped";
import { runAsOrg, type OrgContext } from "@/lib/org-context";
import { platformDb } from "@/lib/platform-db";
import { PLATFORM_ORG_SLUG } from "@/lib/tenant";

/**
 * Running the same scheduled work for every cleaning company on Awer.
 *
 * A cron job has no host, so it has no tenant. Written the old way — one query
 * against the whole table — it now returns nothing at all, because the
 * application role has no organization set and row-level security refuses
 * everything. That fails closed, which is the right way round, but it means the
 * reminders stop going out.
 *
 * So scheduled work loops instead: each organization in turn, with its own
 * scoped client and its own context, so the queries see one company's rows and
 * the emails carry that company's address.
 */

export interface OrgRunResult<T> {
  slug: string;
  ok: boolean;
  result?: T;
  error?: string;
}

/**
 * Run `fn` once per active organization.
 *
 * **One company's failure does not stop the others.** A cron run that aborts
 * half way leaves every remaining company without its reminders that day, and
 * the failure that caused it is usually specific to one workspace's data. Each
 * organization is therefore caught separately and reported, and the response
 * carries the per-company outcome so a bad one is visible rather than silent.
 *
 * Suspended, cancelled and not-yet-provisioned workspaces are skipped: they
 * cannot be used, so sending their customers a reminder about a booking they
 * cannot open would be worse than sending nothing.
 *
 * Sequential on purpose. These jobs send email and SMS, and running every
 * company at once turns a slow provider into a thundering herd against a
 * third-party rate limit.
 */
export async function forEachOrganization<T>(
  fn: (db: ScopedDb, org: OrgContext) => Promise<T>,
): Promise<OrgRunResult<T>[]> {
  const orgs = await platformDb.organization.findMany({
    // Awer's own workspace is excluded. It is not a cleaning company: it has no
    // customers to remind, no cleaners to pay and no statements to send. Left in,
    // it quietly acquired a payroll period and a run of monthly statements on the
    // first real cron run -- work that means nothing and would confuse anyone
    // who later looked at it.
    where: { status: "ACTIVE", slug: { not: PLATFORM_ORG_SLUG } },
    select: { id: true, slug: true, name: true, timezone: true },
    orderBy: { slug: "asc" },
  });

  const out: OrgRunResult<T>[] = [];

  for (const org of orgs) {
    try {
      const result = await runAsOrg(org, () => fn(scopedTo(rawDb, org.id), org));
      out.push({ slug: org.slug, ok: true, result });
    } catch (e) {
      console.error(`cron failed for ${org.slug}`, e);
      out.push({
        slug: org.slug,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return out;
}

/** A short summary for the cron response, so a failure is obvious in the logs. */
export function summarise<T>(results: OrgRunResult<T>[]) {
  const failed = results.filter((r) => !r.ok);
  return {
    organizations: results.length,
    succeeded: results.length - failed.length,
    failed: failed.length,
    failures: failed.map((f) => ({ slug: f.slug, error: f.error })),
    results,
  };
}
