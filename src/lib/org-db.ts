/**
 * The organization-scoped database client, as a drop-in for `@/db`.
 *
 *   -import { db } from "@/db";
 *   +import { db } from "@/lib/org-db";
 *
 * That one-line swap is the whole migration for a file. Every `db.job.findMany`
 * below it keeps working, and is now confined to the organization serving the
 * request.
 *
 * WHY A PROXY, rather than `const db = await getScopedDb()` in each function.
 *
 * The scoped client has to be awaited, so the alternative was inserting a line
 * into the body of every async function that touches the database -- 19 of them
 * in a single file in the cleaner area alone, across ~366 files. That is a lot
 * of hand-edits, each one a chance to put the line in the wrong scope, and a
 * mistake there is a cross-tenant read rather than a crash.
 *
 * A proxy makes it a one-line import change instead: mechanical, greppable, and
 * trivial to review. Every Prisma model operation already returns a promise, so
 * resolving the organization inside the call changes nothing about how call
 * sites are written.
 *
 * OUTSIDE A REQUEST this throws, and that is intended. Cron jobs, webhooks and
 * scripts have no host to resolve, so they must name the organization
 * explicitly -- see scopedTo() in db-scoped.ts. Failing loudly there is the
 * point: those are exactly the places where quietly operating on the wrong
 * tenant would go unnoticed.
 */
import { getScopedDb, requireOrgId } from "@/lib/org";
import { announceTenant, tenantConnection } from "@/lib/db-scoped";
import type { ScopedDb } from "@/lib/db-scoped";

type AnyFn = (...args: unknown[]) => unknown;

/** Forwards one model operation (db.job.findMany) to the scoped client. */
function modelProxy(model: string) {
  return new Proxy({} as Record<string, AnyFn>, {
    get(_t, operation: string) {
      return async (...args: unknown[]) => {
        const scoped = (await getScopedDb()) as unknown as Record<
          string,
          Record<string, AnyFn>
        >;
        return scoped[model][operation](...args);
      };
    },
  });
}

const cache = new Map<string, unknown>();

export const db = new Proxy({} as ScopedDb, {
  get(_t, prop: string | symbol) {
    if (typeof prop !== "string") return undefined;

    // Interactive transactions hold one connection for their whole body, so the
    // tenant is announced once at the top and every operation inside runs on a
    // connection that already knows it. Without this each nested operation would
    // open its own transaction on a different connection, and the announcement
    // and the query would land in different places -- the classic way RLS turns
    // into blank screens.
    if (prop === "$transaction") {
      return async (arg: unknown, ...rest: unknown[]) => {
        const scoped = (await getScopedDb()) as unknown as Record<string, AnyFn>;
        const organizationId = await requireOrgId();
        if (typeof arg === "function") {
          const body = arg as (tx: unknown) => Promise<unknown>;
          return scoped.$transaction(async (tx: unknown) => {
            await announceTenant(
              tx as { $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<unknown> },
              organizationId,
            );
            return tenantConnection.run(organizationId, () => body(tx));
          }, ...rest);
        }
        // Array form: the statements are already batched onto one connection,
        // so the announcement is prepended to the batch.
        const scopedAny = scoped as unknown as {
          $executeRawUnsafe: (q: string, ...v: unknown[]) => unknown;
        };
        const batch = [
          scopedAny.$executeRawUnsafe(
            "SELECT set_config('app.current_org_id', $1, true)",
            organizationId,
          ),
          ...(arg as unknown[]),
        ];
        const out = (await scoped.$transaction(batch, ...rest)) as unknown[];
        return out.slice(1);
      };
    }

    // Raw SQL bypasses the query extension entirely, so it gets the tenant
    // announced around it and must still carry its own organizationId filter --
    // the policies protect it, the extension cannot.
    if (prop === "$queryRaw" || prop === "$queryRawUnsafe" ||
        prop === "$executeRaw" || prop === "$executeRawUnsafe") {
      return async (...callArgs: unknown[]) => {
        const scoped = (await getScopedDb()) as unknown as Record<string, AnyFn>;
        if (tenantConnection.getStore()) return scoped[prop](...callArgs);
        const organizationId = await requireOrgId();
        return scoped.$transaction(async (tx: unknown) => {
          await announceTenant(
            tx as { $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<unknown> },
            organizationId,
          );
          return (tx as Record<string, AnyFn>)[prop](...callArgs);
        });
      };
    }

    // Everything else on the client ($connect, $disconnect, ...) passes through.
    if (prop.startsWith("$")) {
      return async (...args: unknown[]) => {
        const scoped = (await getScopedDb()) as unknown as Record<string, AnyFn>;
        return scoped[prop](...args);
      };
    }

    let m = cache.get(prop);
    if (!m) {
      m = modelProxy(prop);
      cache.set(prop, m);
    }
    return m;
  },
}) as ScopedDb;
