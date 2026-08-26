/**
 * Allocate the next job number for an organization.
 *
 * Job numbers used to come from one Postgres sequence shared by the whole
 * database, so a second company's first job would have been #265. Each
 * organization now counts its own from 1, held in Organization.nextJobNumber.
 *
 * The allocation is a single UPDATE ... RETURNING, which takes a row lock for
 * the duration of the statement, so two jobs created at the same moment cannot
 * receive the same number. Doing it as a read-then-write in application code
 * would race.
 *
 * Numbers are allocated outside any transaction, so a job creation that fails
 * afterwards leaves a gap in the sequence. That is deliberate: gaps in job
 * numbers are harmless, whereas holding the organization row locked for the
 * whole of a long job-creation path would serialise every booking.
 *
 * Uses the UNSCOPED client on purpose. Organization is not a tenant-scoped
 * model -- it is the tenant -- and the id is named explicitly here, including
 * by callers with no request context such as the seeder.
 */
import { db as rawDb } from "@/db";
import { requireOrgId } from "@/lib/org";

export async function allocateJobNumber(organizationId?: string): Promise<number> {
  const orgId = organizationId ?? (await requireOrgId());

  const rows = await rawDb.$queryRaw<Array<{ allocated: number }>>`
    UPDATE "Organization"
       SET "nextJobNumber" = "nextJobNumber" + 1
     WHERE "id" = ${orgId}
    RETURNING "nextJobNumber" - 1 AS "allocated"
  `;

  const allocated = rows[0]?.allocated;
  if (allocated === undefined) {
    throw new Error(
      `Cannot allocate a job number: no organization with id "${orgId}".`,
    );
  }
  return Number(allocated);
}
