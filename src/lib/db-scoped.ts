/**
 * A Prisma client bound to one organization.
 *
 * Every query it issues is confined to that organization, so call sites do not
 * have to remember `where: { organizationId }` ~1,400 times. Hand-editing that
 * many call sites would be the least safe option available: Prisma's `where` is
 * optional, so a missed one is not a type error -- it is a silent cross-tenant
 * read that looks perfectly normal in review.
 *
 * WHAT IS COVERED
 *
 *   findMany / findFirst(OrThrow) / count / aggregate / groupBy
 *   updateMany / deleteMany              -> organizationId injected into `where`
 *   create / createMany(AndReturn)       -> organizationId set on `data`
 *   findUnique(OrThrow)                  -> result rejected if it belongs elsewhere
 *   update / delete / upsert             -> ownership checked before the write
 *
 * WHAT IS NOT, AND WHY THAT IS ACCEPTABLE
 *
 *   Nested writes (`create: { job: { create: {...} } }`) do not inherit the
 *   organization. They are left to fail: once organizationId is NOT NULL in
 *   Step 5, such a write errors instead of writing an unclaimed row. Loud
 *   beats silent.
 *
 *   $queryRaw bypasses extensions entirely.
 *
 * Both gaps are closed by row-level security in Step 5. The two layers are
 * deliberately independent: this one keeps application code honest and gives
 * good errors, RLS makes isolation a property of the database that holds even
 * if this file is bypassed.
 */
import { PrismaClient } from "@prisma/client";

import { TENANT_MODELS } from "@/lib/tenant-models";

/** Operations whose `where` can carry a plain equality filter. */
const FILTERABLE = new Set([
  "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
  "updateMany", "deleteMany",
]);

/** Operations that write new rows and must be stamped. */
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);

/** Single-row writes addressed by a unique field — need an ownership check. */
const UNIQUE_WRITES = new Set(["update", "delete", "upsert"]);

/** Prisma delegates are the model name with a lowercased first letter. */
function delegateOf(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export class CrossTenantError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Refused ${operation} on ${model}: the row belongs to a different organization.`,
    );
    this.name = "CrossTenantError";
  }
}

/**
 * Bind a client to one organization. The returned client is a normal Prisma
 * client as far as call sites are concerned.
 */
export function scopedTo(base: PrismaClient, organizationId: string) {
  if (!organizationId) throw new Error("scopedTo requires an organizationId");

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Unscoped by design: better-auth internals and Organization itself.
          if (!model || !TENANT_MODELS.has(model)) return query(args);

          const a = (args ?? {}) as Record<string, unknown>;

          if (FILTERABLE.has(operation)) {
            return query({
              ...a,
              where: { ...(a.where as object | undefined), organizationId },
            });
          }

          if (CREATES.has(operation)) {
            const data = a.data;
            return query({
              ...a,
              data: Array.isArray(data)
                ? data.map((d) => ({ ...d, organizationId }))
                : { ...(data as object | undefined), organizationId },
            });
          }

          // findUnique cannot carry a non-unique filter, so it is re-issued as a
          // findFirst that can.
          //
          // The obvious alternative -- run the query and check the row's
          // organizationId afterwards -- is wrong, and quietly so: a caller
          // passing `select: { role: true }` gets back a row with no
          // organizationId on it, the check reads undefined, and every lookup is
          // rejected as foreign. better-auth's session handler does exactly
          // that, so this would have silently downgraded the role on every
          // request.
          //
          // Compound-key lookups cannot be spread into findFirst, so those keep
          // the after-the-fact check, re-reading organizationId by id when the
          // caller's select left it out.
          if (operation === "findUnique" || operation === "findUniqueOrThrow") {
            const where = (a.where ?? {}) as Record<string, unknown>;
            const isCompoundKey = Object.values(where).some(
              (v) => v !== null && typeof v === "object" && !(v instanceof Date),
            );

            if (!isCompoundKey) {
              const delegate = (base as unknown as Record<string, {
                findFirst: (q: unknown) => Promise<unknown>;
              }>)[delegateOf(model)];
              const row = await delegate.findFirst({
                ...a,
                where: { ...where, organizationId },
              });
              if (!row && operation === "findUniqueOrThrow") {
                throw new CrossTenantError(model, operation);
              }
              return row;
            }

            const row = (await query(a)) as
              | { id?: string; organizationId?: string }
              | null;
            if (!row) return row;
            let owner = row.organizationId;
            if (owner === undefined && row.id) {
              const delegate = (base as unknown as Record<string, {
                findFirst: (q: unknown) => Promise<{ organizationId: string } | null>;
              }>)[delegateOf(model)];
              owner = (await delegate.findFirst({
                where: { id: row.id },
                select: { organizationId: true },
              }))?.organizationId;
            }
            if (owner !== organizationId) {
              if (operation === "findUniqueOrThrow") {
                throw new CrossTenantError(model, operation);
              }
              return null;
            }
            return row;
          }

          // update/delete/upsert address one row by a unique field, which also
          // cannot carry the filter. Confirm ownership first; a write to another
          // tenant's row is refused rather than silently applied.
          if (UNIQUE_WRITES.has(operation)) {
            const where = a.where as Record<string, unknown> | undefined;
            if (where) {
              const delegate = (base as unknown as Record<string, {
                findFirst: (q: unknown) => Promise<unknown>;
              }>)[delegateOf(model)];
              const owned = await delegate.findFirst({
                where: { ...where, organizationId },
                select: { id: true },
              });
              if (!owned) {
                // upsert on a row that does not exist yet is a create, which is
                // legitimate; anything else is reaching across tenants.
                if (operation === "upsert") {
                  const anywhere = await delegate.findFirst({
                    where, select: { id: true },
                  });
                  if (anywhere) throw new CrossTenantError(model, operation);
                } else {
                  throw new CrossTenantError(model, operation);
                }
              }
            }
            if (operation === "upsert") {
              // The TENANT_MODELS guard above has already excluded Organization
              // and the better-auth tables, but $allModels types `create` as the
              // union across every model, which includes ones with no
              // organizationId. The cast asserts what the guard established.
              return query({
                ...a,
                create: { ...(a.create as object | undefined), organizationId },
              } as typeof args);
            }
            return query(a);
          }

          return query(a);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedTo>;

/**
 * The client handed to a `$transaction` callback on a scoped client.
 *
 * An extended client's transaction client is not `Prisma.TransactionClient` --
 * it carries the extension's types -- so helpers that accept "something you can
 * query with inside a transaction" must name this instead.
 */
export type ScopedTx = Omit<
  ScopedDb,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
