// A rate limit every instance shares: fixed windows counted in Postgres.
//
// lib/rate-limit.ts and the discovery limiter count in memory, per instance,
// and Vercel runs several, so an attacker spreading requests gets
// `limit x instances`. This is the second layer behind those, for the
// endpoints where that matters: phone workspace discovery (per email and per
// address), forgot-password, withdrawals, upload signing, and better-auth's
// sign-in / sign-up / reset counters (see betterAuthRateLimitStorage).
//
// WHY THE PLATFORM CLIENT. The counters are keyed by email or address on the
// platform host, before any company is known, and better-auth's per-address
// counters span companies. There is no organizationId to scope them by, so
// RateLimitCounter is not a tenant table: RLS is forced with no policy and the
// tenant role (awer_app) has no grant, and the only way in is platformDb.
// Nothing here reads a tenant's data; it counts.
//
// NO RAW PII. A key is an HMAC-SHA256 (keyed with BETTER_AUTH_SECRET) of the
// limit's name, window and subject; the email or address never reaches the
// table, and without the secret a digest can't be matched to a guess.
//
// FAILURE. sharedLimitHit throws when the store can't be reached, and callers
// on the v1 path turn that into a refusal (fail closed): each of them is
// already useless without the database. better-auth's storage falls back to
// its in-memory counters instead, so web sign-in keeps its first layer.
//
// Still recommended (owner action): a Vercel WAF rate-limit rule on
// /api/auth/* and /api/v1/auth/*, which stops a flood before it costs a
// function invocation or a write.
import "server-only";

import { createHmac } from "node:crypto";

// Not @/lib/platform-db: that imports lib/auth, which imports this file.
import { platformDb } from "@/lib/platform-client";

export interface SharedLimit {
  max: number;
  windowMs: number;
}

function digest(parts: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("shared-rate-limit: BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(parts).digest("hex");
}

/**
 * Count one hit against `name` for `subject` in the current fixed window, on
 * every instance, and say whether it is over `max`. `subject` may be an email
 * or an address: only its keyed digest is stored. Throws if the store fails.
 */
export async function sharedLimitHit(name: string, subject: string, opts: SharedLimit, now = Date.now()): Promise<boolean> {
  const windowStart = Math.floor(now / opts.windowMs) * opts.windowMs;
  const key = digest(`fw|${name}|${opts.windowMs}|${windowStart}|${subject}`);
  const expiresAt = windowStart + opts.windowMs;
  const rows = await platformDb.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitCounter" ("key", "count", "windowStart", "expiresAt")
    VALUES (${key}, 1, ${BigInt(windowStart)}, ${BigInt(expiresAt)})
    ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimitCounter"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? Number.POSITIVE_INFINITY);
  return count > opts.max;
}

/** Delete expired counters. For the retention cron. */
export async function deleteExpiredRateLimits(now = Date.now()): Promise<number> {
  return platformDb.$executeRaw`DELETE FROM "RateLimitCounter" WHERE "expiresAt" < ${BigInt(now)}`;
}

// ── better-auth's storage ───────────────────────────────────────────────────

interface BetterAuthRateLimit {
  key: string;
  count: number;
  lastRequest: number;
}

/**
 * better-auth paths whose counters are shared. Everything else (get-session,
 * sign-out, …) stays in memory: those are reads or harmless, and a database
 * round trip on each would cost more than it protects.
 */
const SHARED_AUTH_PATHS = [
  "/sign-in",
  "/sign-up",
  "/request-password-reset",
  "/forget-password",
  "/reset-password",
  "/change-password",
  "/change-email",
  "/send-verification-email",
];

/** better-auth's key is `${ip}|${path}`. */
function isSharedAuthKey(key: string): boolean {
  const path = key.slice(key.lastIndexOf("|") + 1);
  return SHARED_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** How long a better-auth counter row outlives its last request. Longer than any window it uses. */
const AUTH_ROW_TTL_MS = 60 * 60_000;

const memory = new Map<string, BetterAuthRateLimit>();
const MEMORY_MAX = 50_000;

const memoryStore = {
  get(key: string): BetterAuthRateLimit | null {
    return memory.get(key) ?? null;
  },
  set(key: string, value: BetterAuthRateLimit): void {
    if (memory.size >= MEMORY_MAX) {
      // Anything idle for longer than every window better-auth uses is stale.
      const cutoff = Date.now() - AUTH_ROW_TTL_MS;
      for (const [k, v] of memory) if (v.lastRequest < cutoff) memory.delete(k);
      if (memory.size >= MEMORY_MAX) memory.clear();
    }
    memory.set(key, { key, count: value.count, lastRequest: value.lastRequest });
  },
};

/**
 * better-auth's `rateLimit.customStorage`: sign-in, sign-up and password
 * reset counters in RateLimitCounter, shared by every instance; the rest in
 * memory, as before. better-auth reads then writes; the write increments in
 * the database rather than storing the count it read, so two instances
 * counting at once don't lose a hit. On a database error, the in-memory
 * counters answer instead (logged), so the first layer is never lost.
 */
export function betterAuthRateLimitStorage() {
  return {
    async get(key: string): Promise<BetterAuthRateLimit | null> {
      if (!isSharedAuthKey(key)) return memoryStore.get(key);
      try {
        const rows = await platformDb.$queryRaw<{ count: number; windowStart: bigint }[]>`
          SELECT "count", "windowStart" FROM "RateLimitCounter" WHERE "key" = ${digest(`ba|${key}`)}`;
        const row = rows[0];
        if (!row) return null;
        return { key, count: Number(row.count), lastRequest: Number(row.windowStart) };
      } catch (e) {
        console.error(JSON.stringify({ at: "shared-rate-limit.auth.get", error: String(e).slice(0, 200) }));
        return memoryStore.get(key);
      }
    },
    async set(key: string, value: BetterAuthRateLimit, update?: boolean): Promise<void> {
      memoryStore.set(key, value);
      if (!isSharedAuthKey(key)) return;
      try {
        const k = digest(`ba|${key}`);
        const last = BigInt(value.lastRequest);
        const expires = BigInt(value.lastRequest + AUTH_ROW_TTL_MS);
        if (!update || value.count <= 1) {
          // A first hit, or a window that has lapsed: start again at this count.
          await platformDb.$executeRaw`
            INSERT INTO "RateLimitCounter" ("key", "count", "windowStart", "expiresAt")
            VALUES (${k}, ${value.count}, ${last}, ${expires})
            ON CONFLICT ("key") DO UPDATE
              SET "count" = EXCLUDED."count", "windowStart" = EXCLUDED."windowStart", "expiresAt" = EXCLUDED."expiresAt"`;
        } else {
          await platformDb.$executeRaw`
            INSERT INTO "RateLimitCounter" ("key", "count", "windowStart", "expiresAt")
            VALUES (${k}, ${value.count}, ${last}, ${expires})
            ON CONFLICT ("key") DO UPDATE
              SET "count" = "RateLimitCounter"."count" + 1, "windowStart" = EXCLUDED."windowStart", "expiresAt" = EXCLUDED."expiresAt"`;
        }
      } catch (e) {
        console.error(JSON.stringify({ at: "shared-rate-limit.auth.set", error: String(e).slice(0, 200) }));
      }
    },
  };
}
