/**
 * The models carrying organizationId — derived from the schema, not listed.
 *
 * Anything NOT in this set is either a better-auth internal (Account, Session,
 * Verification) or Organization itself, and is intentionally unscoped.
 *
 * This used to be a hand-written list of 98 names with a comment asking the
 * next person to "regenerate if the schema gains a tenant-scoped model". That
 * is a bad instruction to leave lying around, because of what happens when it
 * is missed: the gate in db-scoped.ts is
 *
 *   if (!model || !TENANT_MODELS.has(model)) return query(args);
 *
 * — a model absent from this set is passed straight through with no filter, no
 * ownership check, no transaction and no tenant announced. Not a degraded
 * query: an unscoped one, returning every company's rows. And the list had to
 * be kept in step with a second hand-written list in the row-level-security
 * migration, in a different language, in a different part of the tree.
 *
 * Both were correct at the time this was written — 98 models, 98 entries, 98
 * policies, verified in all directions — so deriving the set changes nothing
 * today. It changes what happens on the day someone adds a tenant table and
 * updates only one of the two places.
 *
 * Prisma.dmmf is the schema as the client itself understands it, so this cannot
 * drift from the model definitions. It does not, however, know about the RLS
 * policies — that side still needs the assertion described in docs/cutover/SECURITY.md.
 */
import { Prisma } from "@prisma/client";

export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "organizationId"))
    .map((m) => m.name),
);
