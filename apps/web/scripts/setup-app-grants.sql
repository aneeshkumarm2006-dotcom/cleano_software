-- Privileges for the application role, applied AFTER migrations.
--
-- A table created by a migration has no grants for awer_app, so this runs last
-- and is safe to re-run after any future migration.
--
--   psql "$ELEVATED_URL" -f scripts/setup-app-grants.sql

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO awer_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO awer_app;

-- New tables from future migrations, without having to remember this file.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO awer_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO awer_app;

-- ---------------------------------------------------------------------------
-- ...except the platform's own tables.
--
-- These belong to no organization, so row-level security has no column to key a
-- policy on. Their whole protection is that the application role cannot reach
-- them at all -- only the console's elevated client can. The blanket GRANT
-- above would silently undo that, so the revokes come after it.
--
-- PlatformAuditLog: a record ABOUT organizations. A tenant reading it would see
--   which other companies exist and what staff did to them.
-- AccessRequest: prospective customers' names, emails and phone numbers.
-- ---------------------------------------------------------------------------
REVOKE ALL ON "PlatformAuditLog" FROM awer_app;
REVOKE ALL ON "AccessRequest" FROM awer_app;
