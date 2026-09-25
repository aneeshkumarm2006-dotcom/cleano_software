-- CreateEnum
CREATE TYPE "NotificationRecipient" AS ENUM ('ADMIN', 'CUSTOMER', 'PROVIDER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'APP_PUSH');

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "recipient" "NotificationRecipient" NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isProposed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationSetting_recipient_idx" ON "NotificationSetting"("recipient");

-- CreateIndex
CREATE INDEX "NotificationSetting_category_idx" ON "NotificationSetting"("category");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_recipient_key_channel_key" ON "NotificationSetting"("recipient", "key", "channel");
