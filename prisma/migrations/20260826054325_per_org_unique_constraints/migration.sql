-- DropIndex
DROP INDEX "public"."AlertRoutingRule_alertType_recipientRole_key";

-- DropIndex
DROP INDEX "public"."AppSetting_key_key";

-- DropIndex
DROP INDEX "public"."BudgetCategory_slug_key";

-- DropIndex
DROP INDEX "public"."Invoice_invoiceNumber_key";

-- DropIndex
DROP INDEX "public"."LandingPage_slug_key";

-- DropIndex
DROP INDEX "public"."NotificationSetting_recipient_key_channel_key";

-- DropIndex
DROP INDEX "public"."PricingRule_bedCount_bathCount_key";

-- DropIndex
DROP INDEX "public"."PromoCode_code_key";

-- DropIndex
DROP INDEX "public"."ServiceArea_prefix_key";

-- DropIndex
DROP INDEX "public"."Target_metric_period_periodStart_key";

-- CreateIndex
CREATE UNIQUE INDEX "AlertRoutingRule_organizationId_alertType_recipientRole_key" ON "AlertRoutingRule"("organizationId", "alertType", "recipientRole");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_organizationId_key_key" ON "AppSetting"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetCategory_organizationId_slug_key" ON "BudgetCategory"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_invoiceNumber_key" ON "Invoice"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_organizationId_slug_key" ON "LandingPage"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_organizationId_recipient_key_channel_key" ON "NotificationSetting"("organizationId", "recipient", "key", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_organizationId_bedCount_bathCount_key" ON "PricingRule"("organizationId", "bedCount", "bathCount");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_organizationId_code_key" ON "PromoCode"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceArea_organizationId_prefix_key" ON "ServiceArea"("organizationId", "prefix");

-- CreateIndex
CREATE UNIQUE INDEX "Target_organizationId_metric_period_periodStart_key" ON "Target"("organizationId", "metric", "period", "periodStart");

