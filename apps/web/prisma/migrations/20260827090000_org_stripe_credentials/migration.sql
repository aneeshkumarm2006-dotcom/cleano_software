-- Per-organization Stripe credentials.
--
-- Until now one STRIPE_SECRET_KEY served the whole platform, so a second
-- company's customer paying a deposit would have paid it into the FIRST
-- company's Stripe account. Not a crash -- money in the wrong bank account.
--
-- All five columns are nullable and nothing is backfilled. A workspace with
-- nothing here cannot take card payments, which is the safe way to be wrong;
-- the workspace the environment's key belongs to is named by
-- STRIPE_ENV_ORG_SLUG and keeps working untouched.
--
-- The two secrets are stored encrypted (AES-256-GCM, see lib/secret-box.ts).
-- The publishable key is public by design and is stored as given.
ALTER TABLE "Organization"
  ADD COLUMN "stripeSecretKeyEnc"     TEXT,
  ADD COLUMN "stripePublishableKey"   TEXT,
  ADD COLUMN "stripeWebhookSecretEnc" TEXT,
  ADD COLUMN "stripeKeyHint"          TEXT,
  ADD COLUMN "stripeConnectedAt"      TIMESTAMP(3);
