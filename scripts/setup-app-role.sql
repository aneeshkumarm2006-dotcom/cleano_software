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
--
-- SAFE TO RE-RUN. It will NOT touch the password of a role that already
-- exists, and that restraint is the whole point of the guard below.
--
-- A Postgres role belongs to the SERVER, not to one database. So running this
-- against a scratch database -- a cutover rehearsal, a restored copy, a second
-- deploy where someone did not have the original password to hand -- used to
-- rotate the password out from under the live application on the same server.
-- Nothing errors. Every request simply starts failing with "authentication
-- failed against database server", which reads like the database is down.
--
-- That happened once, locally, during the cutover rehearsal. It would have
-- been an outage in production.
--
-- To deliberately rotate the password, ask for it:
--
--   psql "$ELEVATED_URL" -v pw=newpassword -v rotate_password=yes \
--     -f scripts/setup-app-role.sql
--
-- and remember the application's DATABASE_URL has to change in the same breath.

-- Default the rotate flag, so an ordinary run does not fail on an unset
-- variable and does not have to think about it.
\if :{?rotate_password}
\else
  \set rotate_password no
\endif

-- Whether we are about to create it has to be captured BEFORE we create it.
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awer_app')
              THEN 'no' ELSE 'yes' END AS creating_role
\gset

-- Create it only if missing. `\gexec` runs the text a query returns, which is
-- how a conditional CREATE ROLE is expressed in plain psql -- a DO block cannot
-- be used here because psql variables are not substituted inside dollar quotes.
SELECT 'CREATE ROLE awer_app LOGIN'
 WHERE :'creating_role' = 'yes'
\gexec

-- Set the password when creating the role, or when explicitly asked to rotate
-- it. Never silently on a re-run: see the note at the top.
SELECT format('ALTER ROLE awer_app LOGIN PASSWORD %L', :'pw')
 WHERE :'creating_role' = 'yes' OR :'rotate_password' = 'yes'
\gexec

SELECT CASE
         WHEN :'creating_role' = 'yes' THEN 'role created, password set'
         WHEN :'rotate_password' = 'yes' THEN 'role existed, PASSWORD ROTATED'
         ELSE 'role existed, password left alone'
       END AS password_action;

-- Harden the role: VERIFY, do not force.
--
-- `ALTER ROLE awer_app NOSUPERUSER NOBYPASSRLS ...` is what this used to do, and
-- on Supabase it fails outright:
--
--   ERROR: permission denied to alter role
--   DETAIL: Only roles with the SUPERUSER attribute may alter roles with the
--           SUPERUSER attribute.
--
-- Supabase's `postgres` is NOT a superuser, and only a superuser may touch the
-- SUPERUSER or BYPASSRLS attributes -- even to turn them off. With
-- ON_ERROR_STOP that aborted the script here, silently skipping the two GRANTs
-- below and leaving a role that could not connect at all.
--
-- It does not need forcing. A plain CREATE ROLE already yields NOSUPERUSER,
-- NOBYPASSRLS, NOCREATEDB and NOCREATEROLE. So check the attributes that matter
-- and stop hard if they are ever wrong, because row-level security is purely
-- decorative under a role that can bypass it.
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
    INTO r FROM pg_roles WHERE rolname = 'awer_app';

  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION
      'awer_app has SUPERUSER=% BYPASSRLS=% -- row-level security would not '
      'apply to it. Do not point the application at this role.',
      r.rolsuper, r.rolbypassrls;
  END IF;

  IF r.rolcreatedb OR r.rolcreaterole THEN
    RAISE WARNING 'awer_app has CREATEDB=% CREATEROLE=% -- more than it needs.',
      r.rolcreatedb, r.rolcreaterole;
  END IF;

  RAISE NOTICE 'awer_app verified: NOSUPERUSER, NOBYPASSRLS.';
END $$;

-- NOINHERIT is not a superuser-only attribute, so this one can be set, and it
-- is worth setting. Supabase ships several roles that CAN bypass RLS
-- (service_role, supabase_admin, supabase_read_only_user, supabase_etl_admin).
-- If awer_app is ever granted membership in one of them, INHERIT would apply
-- those privileges automatically and silently; NOINHERIT requires a deliberate
-- SET ROLE instead.
ALTER ROLE awer_app NOINHERIT;

GRANT CONNECT ON DATABASE postgres TO awer_app;
GRANT USAGE ON SCHEMA public TO awer_app;
