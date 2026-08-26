-- Companies asking for the Organization tier.
--
-- Priced per deal, so it cannot be signed up for: a request goes here, a person
-- reads it, and a workspace is created from it if it is a fit.
--
-- Platform-level, like PlatformAuditLog: these rows belong to no organization.
-- They hold prospective customers' names, email addresses and phone numbers, and
-- no tenant has any business reading them -- so the application role is revoked
-- rather than granted, and the console reaches them through the platform client.
--
-- That means NO row-level security policy here, and that is deliberate rather
-- than an omission: RLS keys off "organizationId", and this table has none. The
-- protection is the revoked grant.

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "fleetSize" TEXT,
    "wantedSlug" TEXT,
    "message" TEXT,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdOrgId" TEXT,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedByEmail" TEXT,
    "decidedAt" TIMESTAMP(3),
    "submittedFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessRequest_status_idx" ON "AccessRequest"("status");

-- CreateIndex
CREATE INDEX "AccessRequest_createdAt_idx" ON "AccessRequest"("createdAt");

-- CreateIndex
CREATE INDEX "AccessRequest_email_idx" ON "AccessRequest"("email");

-- No tenant may read prospective customers. Matches the treatment of
-- PlatformAuditLog in the previous migration.
REVOKE ALL ON "AccessRequest" FROM awer_app;
