-- Force a password change on next login. Set on temp-password accounts
-- created by the BookingKoala import; the portal gates on it until the
-- customer sets their own password. Additive, non-null with default.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
