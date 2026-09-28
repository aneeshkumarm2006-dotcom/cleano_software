-- API hardening: a shared, Postgres-backed fixed-window rate limit counter
-- (src/lib/shared-rate-limit.ts), the second layer behind the per-instance
-- in-memory limits, and better-auth's sign-in/reset limiter's storage.
--
-- Not a tenant table, on purpose: the limits it holds are per email and per
-- address on the platform host (workspace discovery, forgot-password), where
-- no company is known yet, and better-auth's per-address sign-in counters,
-- which span companies. So it has no organizationId and no tenant policy.
-- Instead:
--   - RLS is enabled and forced with NO policy, and awer_app has no grant:
--     the tenant application role cannot read or write it at all;
--   - it is reached only through the platform client (PLATFORM_DATABASE_URL);
--   - keys are HMAC-SHA256 digests (keyed with BETTER_AUTH_SECRET) of the
--     limit name, window and subject, so no email or address is stored.
--
-- Additive only. Rows expire; the daily retention cron deletes them.

CREATE TABLE IF NOT EXISTS "RateLimitCounter" (
  "key"         TEXT    NOT NULL,
  "count"       INTEGER NOT NULL DEFAULT 0,
  -- Epoch milliseconds: the window's start (fixed windows) or the last
  -- request (better-auth's storage). No time zone to get wrong.
  "windowStart" BIGINT  NOT NULL,
  "expiresAt"   BIGINT  NOT NULL,
  CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "RateLimitCounter_expiresAt_idx" ON "RateLimitCounter" ("expiresAt");

ALTER TABLE "RateLimitCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimitCounter" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "RateLimitCounter" FROM awer_app;
