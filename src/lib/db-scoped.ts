/**
 * A Prisma client bound to one organization.
 *
 * Two layers work together here, and they are deliberately independent.
 *
 * This file keeps application code honest: every query it issues is confined to
 * one organization, so call sites do not have to remember
 * `where: { organizationId }` ~1,400 times. Prisma's `where` is optional, so a
 * missed one is not a type error -- it is a silent cross-tenant read that looks
 * perfectly normal in review.
 *
 * Row-level security in the database is the layer that survives a mistake here.
 * Every statement runs inside a transaction that first announces the tenant via
 * `app.current_org_id`, which the policies read. If the announcement were ever
 * missed the policies return nothing rather than everything -- an empty screen,
 * not a leak.
 *
 * WHAT IS COVERED
 *
 *   findMany / findFirst(OrThrow) / count / aggregate / groupBy
 *   updateMany / deleteMany              -> organizationId injected into `where`
 *   create / createMany                  -> stamped, including nested children
 *   findUnique(OrThrow)                  -> re-issued as a filtered findFirst
 *   update / delete / upsert             -> ownership checked before the write
 *
 * `$queryRaw` bypasses extensions entirely and is handled in org-db.ts, which
 * announces the tenant before raw statements too.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { PrismaClient } from "@prisma/client";

import { TENANT_MODELS } from "@/lib/tenant-models";

/**
 * Set while a connection has already announced its tenant.
 *
 * Interactive transactions (`db.$transaction(async tx => ...)`, ~80 of them)
 * hold one connection for their whole body. org-db.ts announces the tenant once
 * at the top of such a transaction; without this flag every operation inside
 * would try to open a *second* transaction on a *different* connection, and the
 * announcement and the query would land in different places -- which is exactly
 * how RLS turns into blank screens.
 */
export const tenantConnection = new AsyncLocalStorage<string>();

/** Announce the tenant for the remainder of the current transaction. */
export async function announceTenant(
  client: { $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<unknown> },
  organizationId: string,
): Promise<void> {
  // set_config(..., true) is transaction-local, which is what makes this safe
  // behind a connection pooler: the setting cannot leak into the next request
  // that borrows the same connection.
  await client.$executeRawUnsafe(
    "SELECT set_config('app.current_org_id', $1, true)",
    organizationId,
  );
}

const FILTERABLE = new Set([
  "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
  "updateMany", "deleteMany",
]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);
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
 * Stamp organizationId onto every row a write payload creates, however deeply
 * nested. A parent write can create children in the same statement -- booking
 * photos, invoice line items, checklist items -- and those are rows in
 * tenant-scoped tables too.
 *
 * Safe to apply blindly: every model reachable by a nested create from a tenant
 * model is itself tenant-scoped. `createMany` is matched by name rather than by
 * looking for a `data` key, because a model may have its own column called
 * `data`.
 */
function stampCreated(value: unknown, organizationId: string): unknown {
  if (Array.isArray(value)) return value.map((v) => stampCreated(v, organizationId));
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "create") {
      out[k] = Array.isArray(v)
        ? v.map((row) => stampRow(row, organizationId))
        : stampRow(v, organizationId);
    } else if (k === "createMany") {
      const cm = (v ?? {}) as Record<string, unknown>;
      out[k] = {
        ...cm,
        data: Array.isArray(cm.data)
          ? cm.data.map((row) => stampRow(row, organizationId))
          : stampRow(cm.data, organizationId),
      };
    } else {
      out[k] = stampCreated(v, organizationId);
    }
  }
  return out;
}

function stampRow(row: unknown, organizationId: string): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
  return {
    ...(stampCreated(row, organizationId) as Record<string, unknown>),
    organizationId,
  };
}

/** What to run, worked out without touching the database. */
interface Plan {
  operation: string;
  args: Record<string, unknown>;
  /** Confirm the addressed row is ours before writing to it. */
  ownershipCheck?: Record<string, unknown>;
  /** upsert may legitimately address a row that does not exist yet. */
  allowMissing?: boolean;
  /** Compound-key reads cannot be filtered up front; check the result instead. */
  postFilter?: boolean;
}

function plan(operation: string, a: Record<string, unknown>, organizationId: string): Plan {
  if (FILTERABLE.has(operation)) {
    return {
      operation,
      args: { ...a, where: { ...(a.where as object | undefined), organizationId } },
    };
  }

  if (CREATES.has(operation)) {
    const data = a.data;
    return {
      operation,
      args: {
        ...a,
        data: Array.isArray(data)
          ? data.map((d) => stampRow(d, organizationId))
          : stampRow(data, organizationId),
      },
    };
  }

  if (operation === "findUnique" || operation === "findUniqueOrThrow") {
    const where = (a.where ?? {}) as Record<string, unknown>;
    // A compound key (`{ organizationId_key: {...} }`) cannot be spread into a
    // findFirst filter, so those keep an after-the-fact check.
    const compound = Object.values(where).some(
      (v) => v !== null && typeof v === "object" && !(v instanceof Date),
    );
    if (compound) return { operation, args: a, postFilter: true };
    return {
      // Re-issued as findFirst so the filter can be applied up front. Checking
      // the returned row's organizationId instead would be wrong, and quietly
      // so: a caller passing `select: { role: true }` gets a row with no
      // organizationId on it, the check reads undefined, and every lookup is
      // rejected as foreign. better-auth's session handler does exactly that.
      operation: operation === "findUnique" ? "findFirst" : "findFirstOrThrow",
      args: { ...a, where: { ...where, organizationId } },
    };
  }

  if (UNIQUE_WRITES.has(operation)) {
    const where = a.where as Record<string, unknown> | undefined;
    const args =
      operation === "upsert"
        ? {
            ...a,
            create: stampRow(a.create, organizationId),
            ...(a.update !== undefined
              ? { update: stampCreated(a.update, organizationId) }
              : {}),
          }
        : operation === "update" && a.data !== undefined
          ? { ...a, data: stampCreated(a.data, organizationId) }
          : a;
    return {
      operation,
      args,
      ownershipCheck: where,
      allowMissing: operation === "upsert",
    };
  }

  return { operation, args: a };
}

export function scopedTo(base: PrismaClient, organizationId: string) {
  if (!organizationId) throw new Error("scopedTo requires an organizationId");

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Unscoped by design: Organization itself, and better-auth's tables.
          if (!model || !TENANT_MODELS.has(model)) return query(args);

          const p = plan(operation, (args ?? {}) as Record<string, unknown>, organizationId);

          // Already inside a transaction that announced this tenant: run on that
          // connection, where the policies enforce ownership.
          //
          // findUnique is passed through untouched here. It cannot carry the
          // injected filter, and the rewrite to findFirst is not available --
          // `query` always runs the operation it was called with. RLS makes
          // another tenant's row invisible on this connection anyway, so the
          // lookup returns nothing exactly as it should.
          if (tenantConnection.getStore() === organizationId) {
            if (operation === "findUnique" || operation === "findUniqueOrThrow") {
              return query(args);
            }
            return query(p.args as typeof args);
          }

          return base.$transaction(async (tx) => {
            await announceTenant(
              tx as unknown as { $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<unknown> },
              organizationId,
            );
            const delegate = (tx as unknown as Record<
              string,
              Record<string, (q: unknown) => Promise<unknown>>
            >)[delegateOf(model)];

            if (p.ownershipCheck) {
              const owned = await delegate.findFirst({
                where: { ...p.ownershipCheck, organizationId },
                select: { id: true },
              });
              if (!owned) {
                if (!p.allowMissing) throw new CrossTenantError(model, operation);
                const anywhere = await delegate.findFirst({
                  where: p.ownershipCheck,
                  select: { id: true },
                });
                if (anywhere) throw new CrossTenantError(model, operation);
              }
            }

            const result = await delegate[p.operation](p.args);

            if (p.postFilter && result) {
              const row = result as { id?: string; organizationId?: string };
              let owner = row.organizationId;
              if (owner === undefined && row.id) {
                owner = (
                  (await delegate.findFirst({
                    where: { id: row.id },
                    select: { organizationId: true },
                  })) as { organizationId?: string } | null
                )?.organizationId;
              }
              if (owner !== organizationId) {
                if (operation === "findUniqueOrThrow") {
                  throw new CrossTenantError(model, operation);
                }
                return null;
              }
            }
            return result;
          });
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedTo>;

/**
 * The client handed to a `$transaction` callback on a scoped client. An
 * extended client's transaction client is not `Prisma.TransactionClient`, so
 * helpers that accept "something you can query with inside a transaction" name
 * this instead.
 */
export type ScopedTx = Omit<
  ScopedDb,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
