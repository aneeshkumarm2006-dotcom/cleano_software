-- Item 7 of cleano_new_fixes.pdf — applicant portal access (decision D4).
--
-- Today a JobApplication is a standalone intake row with no login of any
-- kind, and "Hire" (hireApplicant.ts) instantly mints a full EMPLOYEE
-- account. D4 adds a restricted middle step: an admin can click "Invite to
-- portal" to give an applicant a scoped account (status timeline, document
-- upload, onboarding checklist, respond-to-requests) BEFORE they are hired.
-- "Hire" becomes "Convert": flips an existing APPLICANT to EMPLOYEE instead
-- of always creating a fresh login.
--
-- Three additive pieces, all optional so an application with no invite keeps
-- behaving exactly as it does today (D4's explicit requirement):
--
--   1. `Roles.APPLICANT` — a new enum value, never assigned automatically.
--   2. `JobApplication.userId` — nullable, set only by the invite action.
--   3. `ApplicantInviteToken` / `ApplicantMessage` — new tables, same
--      random-token/expiry/single-use shape as ClientCardSetupToken and
--      JobRatingToken (prisma/schema.prisma), so nothing about token
--      generation, validation or consumption is invented fresh.
--
-- ── Why `ALTER TYPE ... ADD VALUE` is safe here ─────────────────────────────
-- This is the first migration in this repo that adds a value to an existing
-- enum rather than creating a new one. Postgres < 12 refused to run
-- `ADD VALUE` inside a transaction block at all; since PG 12 it is allowed,
-- with the one remaining restriction that the new value cannot be USED
-- (compared, cast, inserted) inside the same transaction that added it. This
-- migration only adds the value — nothing below references 'APPLICANT' — so
-- that restriction never applies, regardless of PG version on the target.
--
-- ── Blast radius ─────────────────────────────────────────────────────────
-- `ADD COLUMN "userId"` is nullable with no default and no backfill: every
-- existing JobApplication row gets `userId = NULL`, which is exactly "no
-- invite sent", i.e. today's behaviour. The two new tables start empty.
-- Nothing here can change a single dollar figure, job, or existing login.

ALTER TYPE "Roles" ADD VALUE 'APPLICANT';

-- JobApplication -> its (optional) portal account.
ALTER TABLE "JobApplication" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "JobApplication_userId_key" ON "JobApplication"("userId");
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Set-password invite token, minted by the "Invite to portal" action and
-- consumed on the public /applicant-invite/[token] page.
CREATE TABLE "ApplicantInviteToken" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "token"     TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApplicantInviteToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApplicantInviteToken_token_key" ON "ApplicantInviteToken"("token");
CREATE INDEX "ApplicantInviteToken_userId_idx" ON "ApplicantInviteToken"("userId");
CREATE INDEX "ApplicantInviteToken_expiresAt_idx" ON "ApplicantInviteToken"("expiresAt");
ALTER TABLE "ApplicantInviteToken" ADD CONSTRAINT "ApplicantInviteToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Minimal two-way "respond to requests" channel, scoped to one application
-- and deliberately separate from JobApplication.notes (private, admin-only,
-- unchanged by this migration).
CREATE TABLE "ApplicantMessage" (
  "id"               TEXT NOT NULL,
  "jobApplicationId" TEXT NOT NULL,
  "authorRole"       TEXT NOT NULL,
  "authorUserId"     TEXT,
  "body"             TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApplicantMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApplicantMessage_jobApplicationId_createdAt_idx"
  ON "ApplicantMessage"("jobApplicationId", "createdAt");
ALTER TABLE "ApplicantMessage" ADD CONSTRAINT "ApplicantMessage_jobApplicationId_fkey"
  FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Post-deploy sanity check (Stage 7.1) ────────────────────────────────────
-- Same convention as the two prior hand-authored migrations: no
-- `RAISE NOTICE`, since Prisma's migration engine discards Postgres notices.
-- Run straight after `prisma migrate deploy` and record the result here.
--
--   SELECT 'APPLICANT' = ANY(enum_range(NULL::"Roles")::text[]) AS role_added;
--   SELECT count(*) FILTER (WHERE "userId" IS NOT NULL) AS linked,
--          count(*) FILTER (WHERE "userId" IS NULL) AS unlinked
--   FROM "JobApplication";
--
-- Expected on the database the Stage 0 probe measured (472 applications... a
-- careers-page count, not the 472 jobs elsewhere in this plan — re-check the
-- live count, they are unrelated tables): role_added = true, linked = 0
-- (no invites exist before this deploy), unlinked = every current row.
