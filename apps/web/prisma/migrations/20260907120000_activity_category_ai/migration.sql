-- The AI assistant gets its own activity-log category, so its failures are
-- visible to an admin in Settings → Logs instead of only in the server console.
-- Additive: no existing row changes, and nothing writes the new value until the
-- code that ships with this migration is deployed.
ALTER TYPE "ActivityCategory" ADD VALUE IF NOT EXISTS 'AI';
