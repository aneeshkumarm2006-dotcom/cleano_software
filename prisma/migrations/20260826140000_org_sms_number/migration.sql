-- A Twilio number per cleaning company.
--
-- Outbound was already configurable, but INBOUND was not: a customer texting
-- back reaches one webhook, and the only thing Twilio tells us about which
-- company they meant is the number that received the message. One number could
-- therefore only ever serve one tenant.
--
-- Both columns are nullable and nothing is backfilled. A workspace with no
-- number falls back to the environment, which is exactly how the first tenant
-- keeps working with no configuration and no change in behaviour.
--
-- "smsNumber" is UNIQUE because it is a routing key. Two workspaces sharing a
-- number would make an inbound message unattributable, and the failure would be
-- one company's customer appearing in another company's chat -- so the database
-- refuses the situation outright rather than leaving it to be handled.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "smsMessagingServiceSid" TEXT,
ADD COLUMN     "smsNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_smsNumber_key" ON "Organization"("smsNumber");
