-- API hardening: tie push tokens to the session that registered them.
--
-- A push token outlived the sign-in that registered it: a phone signed out,
-- revoked, reset or switched off went on receiving the company's push
-- notifications. Now:
--   - PushDevice.sessionId names the registering session, and deleting that
--     session (sign-out, revocation, password reset, expiry) deletes the row
--     by cascade; the app also deletes a person's rows outright when their
--     sessions are revoked or they are switched off (lib/session-revocation.ts);
--   - registering a token in one company removes the same token from every
--     other company, through push_device_release_token(): a narrow SECURITY
--     DEFINER function, because the tenant role can't see other companies'
--     rows (RLS), and shouldn't be able to. It deletes only rows holding that
--     exact token, never the caller's own company's, and returns a count.
--
-- Additive: one nullable column, an index, a foreign key, one function.

ALTER TABLE "PushDevice" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

CREATE INDEX IF NOT EXISTS "PushDevice_sessionId_idx" ON "PushDevice" ("sessionId");

ALTER TABLE "PushDevice"
  ADD CONSTRAINT "PushDevice_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.push_device_release_token(p_token TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  keep_org TEXT := current_setting('app.current_org_id', true);
  n INTEGER;
BEGIN
  -- No company announced, or no token: do nothing rather than guess.
  IF keep_org IS NULL OR keep_org = '' OR p_token IS NULL OR p_token = '' THEN
    RETURN 0;
  END IF;
  DELETE FROM "PushDevice" WHERE "token" = p_token AND "organizationId" <> keep_org;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.push_device_release_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_device_release_token(TEXT) TO awer_app;
