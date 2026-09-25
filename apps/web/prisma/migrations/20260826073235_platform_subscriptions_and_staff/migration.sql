-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPPORT', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "platformRole" "PlatformRole";

-- CreateTable
CREATE TABLE "Subscription" (
    "organizationId" TEXT NOT NULL DEFAULT '',
    "id" TEXT NOT NULL,
    "plan" "OrgPlan" NOT NULL DEFAULT 'STARTER',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "seats" INTEGER,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetOrgId" TEXT,
    "targetOrgSlug" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_trialEndsAt_idx" ON "Subscription"("trialEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_targetOrgId_idx" ON "PlatformAuditLog"("targetOrgId");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_actorId_idx" ON "PlatformAuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Subscription is tenant-scoped like the rest: a company reads its own plan and
-- nobody else's. The super-admin console reads across organizations through the
-- platform client, which connects as a role that bypasses these policies.
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Subscription_tenant_isolation" ON "Subscription";
CREATE POLICY "Subscription_tenant_isolation" ON "Subscription"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- PlatformAuditLog is deliberately NOT tenant-scoped. It is a record about
-- organizations, kept for the platform, and no tenant may read it.
REVOKE ALL ON "PlatformAuditLog" FROM awer_app;

-- The application role needs access to the new tenant table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Subscription" TO awer_app;
