-- Gift card purchase + redemption.

DO $$ BEGIN
  CREATE TYPE "GiftCardStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'REDEEMED', 'REFUNDED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "giftCardBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "GiftCard" (
  "id"                    TEXT PRIMARY KEY,
  "code"                  TEXT NOT NULL UNIQUE,
  "amount"                DOUBLE PRECISION NOT NULL,
  "status"                "GiftCardStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "purchaserName"         TEXT NOT NULL,
  "purchaserEmail"        TEXT NOT NULL,
  "purchaserClientId"     TEXT,
  "recipientName"         TEXT NOT NULL,
  "recipientEmail"        TEXT NOT NULL,
  "personalMessage"       TEXT,
  "scheduledDeliveryDate" TIMESTAMP(3),
  "deliveredAt"           TIMESTAMP(3),
  "coverKey"              TEXT NOT NULL DEFAULT 'default',
  "stripePaymentIntentId" TEXT,
  "redeemedAt"            TIMESTAMP(3),
  "redeemedByClientId"    TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "GiftCard_status_idx"                ON "GiftCard"("status");
CREATE INDEX IF NOT EXISTS "GiftCard_recipientEmail_idx"        ON "GiftCard"("recipientEmail");
CREATE INDEX IF NOT EXISTS "GiftCard_scheduledDeliveryDate_idx" ON "GiftCard"("scheduledDeliveryDate");
CREATE INDEX IF NOT EXISTS "GiftCard_createdAt_idx"             ON "GiftCard"("createdAt");
