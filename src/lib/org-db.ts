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
import { getScopedDb } from "@/lib/org";
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

    // Client-level members ($transaction, $queryRaw, $connect...) forward
    // straight through. Note that $queryRaw is NOT scoped by the extension --
    // raw SQL bypasses it, and must carry its own organizationId filter.
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
