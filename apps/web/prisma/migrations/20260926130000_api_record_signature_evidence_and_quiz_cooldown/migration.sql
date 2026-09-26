-- API v1, the record area: documents and training
-- (packages/api/src/v1/documents.ts, training.ts).
--
-- Additive only. Nullable columns, and three with a constant default, on three
-- existing tables; one backfill of a flag. No new tables, so no new RLS
-- policies or grants: the existing tables' policies and table-level grants
-- cover new columns. Reverses by dropping what it adds.
--
--   Document.contentSha256 / contentSha256Basis
--       SHA-256 of what the document shows (file bytes, text, or the
--       acknowledgement built from title/version/description), and what it
--       was worked out from, so a changed file is noticed and re-hashed.
--   DocumentSignature.signedVersion / signedContentSha256 / consentText /
--   userAgent
--       the evidence kept with a signature: the version and hash that were on
--       screen, the consent sentence as shown, and the signer's User-Agent
--       (ipAddress already exists).
--   TrainingProgress.selfAttested
--       the video/"I've read it" progress is the person's own word, not a
--       record the server observed. Every existing row with any progress was
--       reported by the browser the same way, so it is backfilled to true.
--   TrainingProgress.quizFailStreak / quizCooldownUntil
--       three failed quiz attempts in a row start a 24-hour wait.

ALTER TABLE "Document"
  ADD COLUMN IF NOT EXISTS "contentSha256" TEXT,
  ADD COLUMN IF NOT EXISTS "contentSha256Basis" TEXT;

ALTER TABLE "DocumentSignature"
  ADD COLUMN IF NOT EXISTS "signedVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "signedContentSha256" TEXT,
  ADD COLUMN IF NOT EXISTS "consentText" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

ALTER TABLE "TrainingProgress"
  ADD COLUMN IF NOT EXISTS "selfAttested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quizFailStreak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "quizCooldownUntil" TIMESTAMP(3);

UPDATE "TrainingProgress" SET "selfAttested" = true
WHERE "selfAttested" = false AND ("videoProgress" > 0 OR ("status" = 'COMPLETED' AND "quizScore" IS NULL));
