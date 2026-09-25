-- A workspace's own Twilio account (the "bring your own" half of the texting
-- connector). Additive and nullable: a workspace with these NULL keeps using
-- the platform's Twilio account exactly as before, so nothing changes for
-- anyone until they connect.
ALTER TABLE "Organization" ADD COLUMN "twilioAccountSid"   TEXT;
ALTER TABLE "Organization" ADD COLUMN "twilioAuthTokenEnc" TEXT;
ALTER TABLE "Organization" ADD COLUMN "twilioTokenHint"    TEXT;
ALTER TABLE "Organization" ADD COLUMN "twilioConnectedAt"  TIMESTAMP(3);
