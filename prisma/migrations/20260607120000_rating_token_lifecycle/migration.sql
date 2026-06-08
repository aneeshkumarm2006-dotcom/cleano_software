-- Post-cleaning rating flow: make JobRatingToken the single source of truth
-- for a job's rating lifecycle (email + portal pop-up share one token).
ALTER TABLE "JobRatingToken"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "ratingStars" INTEGER,
  ADD COLUMN "ratherNotAnswer" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailSentAt" TIMESTAMP(3),
  ADD COLUMN "popupShownAt" TIMESTAMP(3);
