// Shared fixed-window rate limiter for the public, unauthenticated surfaces —
// the booking form's actions, the deposit endpoint, the careers form. These
// take real work per call (Stripe objects, database rows, file storage, email)
// on behalf of strangers, which is precisely the audience a limiter exists for.
//
// In-memory and per-instance, the same honest caveat as the workspace-signin
// limiter: Vercel runs several instances, so a determined attacker gets
// `limit × instances`, not `limit`. That still turns "unmetered" into
// "bounded", stops the casual script outright, and needs no infrastructure.
// If a real distributed limit is ever needed, this is the one file to swap.
//
// Fail-open by design: a limiter bug must never block a legitimate customer
// from booking. Callers treat `limited: true` as the exceptional path.
import "server-only";

import { headers } from "next/headers";

interface Bucket {
  n: number;
  resetAt: number;
}

const BUCKETS = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

/** Drop expired buckets so the map cannot grow without bound. */
function prune(now: number) {
  if (BUCKETS.size < MAX_BUCKETS) return;
  for (const [k, b] of BUCKETS) {
    if (b.resetAt < now) BUCKETS.delete(k);
  }
  // Still full of live buckets? We are under active flood; shed oldest-first
  // rather than allocating forever.
  if (BUCKETS.size >= MAX_BUCKETS) {
    for (const k of BUCKETS.keys()) {
      BUCKETS.delete(k);
      if (BUCKETS.size < MAX_BUCKETS / 2) break;
    }
  }
}

/**
 * Count a hit against `name:key` and say whether the caller is over the
 * limit. `name` scopes the counter per endpoint so one endpoint's limit
 * cannot consume another's.
 */
export function rateLimitHit(
  name: string,
  key: string,
  opts: { max: number; windowMs: number },
): boolean {
  const now = Date.now();
  prune(now);
  const k = `${name}:${key}`;
  const b = BUCKETS.get(k);
  if (!b || b.resetAt < now) {
    BUCKETS.set(k, { n: 1, resetAt: now + opts.windowMs });
    return false;
  }
  b.n += 1;
  return b.n > opts.max;
}

/**
 * The common case for server actions: limit by caller IP. Reads the request
 * headers itself so call sites stay one line. Unknown IP (no header) shares
 * one bucket — strange proxies get a collective limit rather than none.
 */
export async function rateLimitByIp(
  name: string,
  opts: { max: number; windowMs: number },
): Promise<boolean> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    return rateLimitHit(name, ip, opts);
  } catch {
    // No request scope (scripts, tests) — do not limit.
    return false;
  }
}
