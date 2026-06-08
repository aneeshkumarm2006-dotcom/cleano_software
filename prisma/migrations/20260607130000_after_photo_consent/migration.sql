-- After-photo consent on booking page + admin override on the job.
ALTER TABLE "Job"
  ADD COLUMN "afterPhotoConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "afterPhotoConsentAt" TIMESTAMP(3),
  ADD COLUMN "afterPhotoConsentVersion" TEXT,
  ADD COLUMN "afterPhotoOverrideAt" TIMESTAMP(3),
  ADD COLUMN "afterPhotoOverrideBy" TEXT;
