-- P1 software fixes batch: customer fixed pricing, per-cleaner job status/pay,
-- announcements backend with reaction limits, client rating edits,
-- per-booking notification mutes, alert->employee deep links, group chat DMs.

-- Customer-specific fixed pricing ("Change Total")
ALTER TABLE "Client" ADD COLUMN "fixedPrice" DOUBLE PRECISION;
ALTER TABLE "Client" ADD COLUMN "fixedPriceRecurring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN "fixedPriceAllowFrequencyDiscount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "usesFixedPrice" BOOLEAN NOT NULL DEFAULT false;

-- Per-booking notification controls
ALTER TABLE "Job" ADD COLUMN "notifyClient" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Job" ADD COLUMN "notifyProvider" BOOLEAN NOT NULL DEFAULT true;

-- Client rating edits
ALTER TABLE "EmployeeRating" ADD COLUMN "editedAt" TIMESTAMP(3);

-- Alert -> employee deep link (refill/equipment alerts)
ALTER TABLE "Alert" ADD COLUMN "employeeId" TEXT;
CREATE INDEX "Alert_employeeId_idx" ON "Alert"("employeeId");

-- Per-cleaner job assignment status + pay
CREATE TYPE "JobCleanerStatus" AS ENUM ('ASSIGNED', 'ON_THE_WAY', 'CLOCKED_IN', 'CLOCKED_OUT', 'COMPLETED', 'CANCELLED');

CREATE TABLE "JobAssignment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "status" "JobCleanerStatus" NOT NULL DEFAULT 'ASSIGNED',
    "onMyWayAt" TIMESTAMP(3),
    "clockInTime" TIMESTAMP(3),
    "clockOutTime" TIMESTAMP(3),
    "payAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobAssignment_jobId_cleanerId_key" ON "JobAssignment"("jobId", "cleanerId");
CREATE INDEX "JobAssignment_cleanerId_idx" ON "JobAssignment"("cleanerId");

ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_cleanerId_fkey" FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Group chat: membership + 1:1 DMs
ALTER TABLE "GroupChannel" ADD COLUMN "isDirect" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GroupChannel" ADD COLUMN "createdById" TEXT;

CREATE TABLE "GroupChannelMember" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupChannelMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupChannelMember_channelId_userId_key" ON "GroupChannelMember"("channelId", "userId");
CREATE INDEX "GroupChannelMember_userId_idx" ON "GroupChannelMember"("userId");

ALTER TABLE "GroupChannelMember" ADD CONSTRAINT "GroupChannelMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "GroupChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Announcements (previously a frontend mock) + limited reactions
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

CREATE TABLE "AnnouncementReaction" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementReaction_announcementId_userId_key" ON "AnnouncementReaction"("announcementId", "userId");
CREATE INDEX "AnnouncementReaction_announcementId_idx" ON "AnnouncementReaction"("announcementId");

ALTER TABLE "AnnouncementReaction" ADD CONSTRAINT "AnnouncementReaction_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
