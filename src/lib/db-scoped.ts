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

import { Prisma, PrismaClient } from "@prisma/client";

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

/**
 * How long a scoped operation may take.
 *
 * Prisma's defaults for an interactive transaction are `timeout: 5000` and
 * `maxWait: 2000`, and they are wrong here — not because they are short, but
 * because of what they are being applied to. Those defaults assume a
 * transaction is something a few call sites opt into deliberately. In this
 * client EVERY query is one, because announcing the tenant with `SET LOCAL`
 * only holds for the transaction that set it.
 *
 * So a five-second budget stopped being "a generous limit for a unit of work"
 * and became "the timeout on every single query in the product", covering the
 * announcement round-trip, an ownership check, the query itself and sometimes a
 * follow-up lookup. Against a database in another region, or on a report that
 * legitimately takes a while, that throws P2028 and the page fails — and it
 * fails *more* the busier things get, which is the worst time for it.
 *
 * Raised well clear of any real query, and left configurable so it can be tuned
 * without a deploy. This is a ceiling that should never be reached, not a
 * target.
 */
const TX_TIMEOUT_MS = Number(process.env.TENANT_TX_TIMEOUT_MS ?? 20_000);
/** How long to wait for a free connection before giving up. */
const TX_MAX_WAIT_MS = Number(process.env.TENANT_TX_MAX_WAIT_MS ?? 10_000);

const TX_OPTIONS = { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS } as const;

/**
 * The same budget for transactions opened by org-db.ts.
 *
 * Those hold a connection for a whole multi-step body, so they need it at least
 * as much as a single query does. Exported rather than duplicated so there is
 * one number to change.
 */
export const TENANT_TX_OPTIONS = TX_OPTIONS;

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

/**
 * The compound unique keys each model has, by the name Prisma wraps them in.
 *
 * `@@unique([channelId, userId])` is addressed as
 * `where: { channelId_userId: { channelId, userId } }`. That shape is legal for
 * findUnique and for the `where` of an update, delete or upsert — and illegal
 * for findFirst, which is what the ownership check below has to issue.
 *
 * Read from the schema rather than guessed at. The tempting shortcut — treat
 * any object-valued key as a compound wrapper — also swallows ordinary filters
 * like `{ status: { in: [...] } }` and turns them into nonsense.
 */
const COMPOUND_KEYS: Map<string, Set<string>> = (() => {
  const out = new Map<string, Set<string>>();
  for (const m of Prisma.dmmf.datamodel.models) {
    const names = new Set<string>();
    // Both shapes: a named @@unique gets its own name, an unnamed one is
    // addressed by its fields joined with underscores.
    for (const idx of m.uniqueIndexes ?? []) {
      if (idx.fields.length > 1) names.add(idx.name || idx.fields.join("_"));
    }
    for (const fields of m.uniqueFields ?? []) {
      if (fields.length > 1) names.add(fields.join("_"));
    }
    if (names.size) out.set(m.name, names);
  }
  return out;
})();

/**
 * A unique `where` rewritten as something findFirst will accept.
 *
 * Only the keys the schema says are compound wrappers are unwrapped; everything
 * else is passed through untouched.
 *
 * Without this, every write addressed by a compound key died: the check issued
 * `findFirst({ where: { channelId_userId: {...} } })` and Prisma rejected the
 * argument outright. Thirty-one models have such a key -- User by
 * organizationId_email, Job by organizationId_jobNumber, Invoice by its number,
 * JobAssignment by job and cleaner -- so this was not one broken page. Opening
 * the team chat was simply the first place anyone pressed the button.
 */
function ownershipFilter(
  model: string,
  where: Record<string, unknown>,
): Record<string, unknown> {
  const compound = COMPOUND_KEYS.get(model);
  if (!compound) return where;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (compound.has(key) && value !== null && typeof value === "object") {
      Object.assign(out, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
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

          // FAST PATH — one round trip instead of four.
          //
          // The interactive form below opens a transaction, announces the
          // tenant, runs the query and commits: four separate exchanges with the
          // database. That is fine once. It is not fine when EVERY query in the
          // product is one, which is what this client makes them. A dashboard
          // issuing a hundred queries was paying four hundred round trips, and
          // against a database in another region that turned a page into twenty
          // seconds -- and eventually into transaction timeouts, because the
          // whole thing is racing a clock that was never meant to cover network
          // latency.
          //
          // Prisma's array form sends the whole batch in a single exchange, and
          // still wraps it in BEGIN/COMMIT -- so `set_config(..., true)` is
          // transaction-local exactly as before and still applies to the
          // statement after it. Identical guarantees, a quarter of the traffic.
          //
          // Only the plans that need no extra queries qualify. Anything with an
          // ownership check or a result to inspect has to see one answer before
          // deciding the next, which a batch cannot express, and those fall
          // through to the interactive path unchanged.
          if (!p.ownershipCheck && !p.postFilter) {
            const delegate = (base as unknown as Record<
              string,
              Record<string, (q: unknown) => unknown>
            >)[delegateOf(model)];

            const batch = [
              base.$executeRawUnsafe(
                "SELECT set_config('app.current_org_id', $1, true)",
                organizationId,
              ),
              delegate[p.operation](p.args),
            ] as unknown as Prisma.PrismaPromise<unknown>[];

            // No timeout option here, and none needed: the array form is not an
            // interactive transaction, so it is not racing the clock that the
            // path below has to be given room against.
            const out = (await base.$transaction(batch)) as unknown[];
            return out[1] as never;
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
              const filter = ownershipFilter(model, p.ownershipCheck);
              const owned = await delegate.findFirst({
                where: { ...filter, organizationId },
                select: { id: true },
              });
              if (!owned) {
                if (!p.allowMissing) throw new CrossTenantError(model, operation);
                const anywhere = await delegate.findFirst({
                  where: filter,
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
          }, TX_OPTIONS);
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
