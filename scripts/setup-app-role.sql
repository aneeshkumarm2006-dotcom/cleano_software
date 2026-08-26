-- The restricted role the application connects as.
--
-- Row-level security is only real if the connecting role cannot bypass it, and
-- Postgres exempts superusers and table owners. Supabase's `postgres` role has
-- rolbypassrls, so policies evaluated under it are decoration -- which is why
-- the application gets its own role that owns nothing.
--
-- Run this BEFORE `prisma migrate deploy`: two migrations REVOKE privileges
-- from awer_app, and a REVOKE naming a role that does not exist is an error.
--
-- Then run setup-app-grants.sql AFTER the migrations, because tables created by
-- a migration have no grants for this role yet.
--
--   psql "$ELEVATED_URL" -v pw=somepassword -f scripts/setup-app-role.sql

-- Create it only if missing. `\gexec` runs the text a query returns, which is
-- how a conditional CREATE ROLE is expressed in plain psql -- a DO block cannot
-- be used here because psql variables are not substituted inside dollar quotes.
SELECT 'CREATE ROLE awer_app LOGIN'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awer_app')
\gexec

ALTER ROLE awer_app LOGIN PASSWORD :'pw';

ALTER ROLE awer_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT CONNECT ON DATABASE postgres TO awer_app;
GRANT USAGE ON SCHEMA public TO awer_app;
