/**
 * The one check every destructive script runs before it touches anything.
 *
 * The rule has always been "never production". It was written as "must be
 * staging", which is not the same sentence — and the difference showed up the
 * first time there was a third legitimate target, a local database, which the
 * guard refused even though it was the safest place of all.
 *
 * Stating the rule as a denylist keeps the guarantee that matters (production is
 * untouchable) without having to re-open the file every time a new safe
 * environment appears.
 */

/** The production Supabase project. Nothing may write here from a script. */
const PRODUCTION_REF = "kbreldosgjzwqnwnvxgw";

export interface TargetCheck {
  ok: boolean;
  label: string;
  reason?: string;
}

/** Where a connection string points, in words. */
export function describeTarget(url: string | undefined): TargetCheck {
  const u = (url ?? "").trim();

  if (!u) {
    return { ok: false, label: "unset", reason: "DATABASE_URL is not set" };
  }
  if (u.includes(PRODUCTION_REF)) {
    return { ok: false, label: "PRODUCTION", reason: "this is the production database" };
  }
  if (/@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(u)) {
    return { ok: true, label: "local" };
  }
  if (u.includes("udgbixmlyqsoalvrjbgo")) {
    return { ok: true, label: "staging" };
  }

  // Unrecognised. Refuse rather than assume: an unfamiliar host is exactly the
  // situation where a guard is worth having.
  return {
    ok: false,
    label: "unknown",
    reason: "unrecognised database host — add it to safe-target.ts if it is safe",
  };
}

/** Throw unless this connection is somewhere a script may safely write. */
export function assertSafeTarget(url: string | undefined, what = "run"): string {
  const t = describeTarget(url);
  if (!t.ok) throw new Error(`refusing to ${what}: ${t.reason}`);
  return t.label;
}
