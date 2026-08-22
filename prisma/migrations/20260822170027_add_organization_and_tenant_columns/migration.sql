-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrgPlan" AS ENUM ('STARTER', 'PROFESSIONAL', 'ORGANIZATION');

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "AdSpendImport" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "AlertRoutingRule" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "AnnouncementReaction" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "AppSetting" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ApplicantInviteToken" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ApplicantMessage" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "AvailabilityException" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "BudgetCategory" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ChecklistTemplate" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ChecklistTemplateItem" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CleanerStrike" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ClientAddress" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ClientCardSetupToken" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ClientPaymentMethod" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ContactActivity" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DocumentAccessLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DocumentSignature" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DuplicateRejection" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeAvailability" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeFile" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeProduct" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeRating" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Faq" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "FaqCategory" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "FaqEvent" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "GroupChannel" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "GroupChannelMember" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "GroupChannelRead" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "GroupMessage" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InventoryChange" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InventoryCheckout" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InventoryCheckoutItem" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InventoryFlag" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InventoryLocation" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InventoryLocationStock" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InventoryRequest" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLineItem" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobAddOn" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobAssignment" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobAssignmentInvite" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobBreak" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobChatMessage" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobChecklist" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobChecklistItem" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobPhoto" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobProductUsage" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobRatingToken" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "JobWorkSession" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "KitTemplate" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "KitTemplateItem" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MarketingCampaign" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "NotificationSetting" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PageVisit" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PayPeriod" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PricingRule" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ProductLink" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PromoCode" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PropertyDefinition" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "QuoteRequest" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "RagWash" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "RecurringCancellation" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ReviewPhoto" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "SalesArea" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ServiceArea" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "SupplierPrice" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Target" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TrainingModule" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TrainingProgress" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TrainingQuiz" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Waitlist" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "WashPayout" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'PENDING',
    "plan" "OrgPlan" NOT NULL DEFAULT 'STARTER',
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE INDEX "ActivityLog_organizationId_idx" ON "ActivityLog"("organizationId");

-- CreateIndex
CREATE INDEX "AdSpendImport_organizationId_idx" ON "AdSpendImport"("organizationId");

-- CreateIndex
CREATE INDEX "Alert_organizationId_idx" ON "Alert"("organizationId");

-- CreateIndex
CREATE INDEX "AlertRoutingRule_organizationId_idx" ON "AlertRoutingRule"("organizationId");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_idx" ON "Announcement"("organizationId");

-- CreateIndex
CREATE INDEX "AnnouncementReaction_organizationId_idx" ON "AnnouncementReaction"("organizationId");

-- CreateIndex
CREATE INDEX "AppSetting_organizationId_idx" ON "AppSetting"("organizationId");

-- CreateIndex
CREATE INDEX "ApplicantInviteToken_organizationId_idx" ON "ApplicantInviteToken"("organizationId");

-- CreateIndex
CREATE INDEX "ApplicantMessage_organizationId_idx" ON "ApplicantMessage"("organizationId");

-- CreateIndex
CREATE INDEX "AvailabilityException_organizationId_idx" ON "AvailabilityException"("organizationId");

-- CreateIndex
CREATE INDEX "Budget_organizationId_idx" ON "Budget"("organizationId");

-- CreateIndex
CREATE INDEX "BudgetCategory_organizationId_idx" ON "BudgetCategory"("organizationId");

-- CreateIndex
CREATE INDEX "ChatConversation_organizationId_idx" ON "ChatConversation"("organizationId");

-- CreateIndex
CREATE INDEX "ChatMessage_organizationId_idx" ON "ChatMessage"("organizationId");

-- CreateIndex
CREATE INDEX "ChecklistTemplate_organizationId_idx" ON "ChecklistTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "ChecklistTemplateItem_organizationId_idx" ON "ChecklistTemplateItem"("organizationId");

-- CreateIndex
CREATE INDEX "CleanerStrike_organizationId_idx" ON "CleanerStrike"("organizationId");

-- CreateIndex
CREATE INDEX "Client_organizationId_idx" ON "Client"("organizationId");

-- CreateIndex
CREATE INDEX "ClientAddress_organizationId_idx" ON "ClientAddress"("organizationId");

-- CreateIndex
CREATE INDEX "ClientCardSetupToken_organizationId_idx" ON "ClientCardSetupToken"("organizationId");

-- CreateIndex
CREATE INDEX "ClientPaymentMethod_organizationId_idx" ON "ClientPaymentMethod"("organizationId");

-- CreateIndex
CREATE INDEX "Commission_organizationId_idx" ON "Commission"("organizationId");

-- CreateIndex
CREATE INDEX "Complaint_organizationId_idx" ON "Complaint"("organizationId");

-- CreateIndex
CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");

-- CreateIndex
CREATE INDEX "ContactActivity_organizationId_idx" ON "ContactActivity"("organizationId");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "DocumentAccessLog_organizationId_idx" ON "DocumentAccessLog"("organizationId");

-- CreateIndex
CREATE INDEX "DocumentSignature_organizationId_idx" ON "DocumentSignature"("organizationId");

-- CreateIndex
CREATE INDEX "DuplicateRejection_organizationId_idx" ON "DuplicateRejection"("organizationId");

-- CreateIndex
CREATE INDEX "EmailLog_organizationId_idx" ON "EmailLog"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeAvailability_organizationId_idx" ON "EmployeeAvailability"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeFile_organizationId_idx" ON "EmployeeFile"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeProduct_organizationId_idx" ON "EmployeeProduct"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeRating_organizationId_idx" ON "EmployeeRating"("organizationId");

-- CreateIndex
CREATE INDEX "Faq_organizationId_idx" ON "Faq"("organizationId");

-- CreateIndex
CREATE INDEX "FaqCategory_organizationId_idx" ON "FaqCategory"("organizationId");

-- CreateIndex
CREATE INDEX "FaqEvent_organizationId_idx" ON "FaqEvent"("organizationId");

-- CreateIndex
CREATE INDEX "GiftCard_organizationId_idx" ON "GiftCard"("organizationId");

-- CreateIndex
CREATE INDEX "GroupChannel_organizationId_idx" ON "GroupChannel"("organizationId");

-- CreateIndex
CREATE INDEX "GroupChannelMember_organizationId_idx" ON "GroupChannelMember"("organizationId");

-- CreateIndex
CREATE INDEX "GroupChannelRead_organizationId_idx" ON "GroupChannelRead"("organizationId");

-- CreateIndex
CREATE INDEX "GroupMessage_organizationId_idx" ON "GroupMessage"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryChange_organizationId_idx" ON "InventoryChange"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryCheckout_organizationId_idx" ON "InventoryCheckout"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryCheckoutItem_organizationId_idx" ON "InventoryCheckoutItem"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryFlag_organizationId_idx" ON "InventoryFlag"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryLocation_organizationId_idx" ON "InventoryLocation"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryLocationStock_organizationId_idx" ON "InventoryLocationStock"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryRequest_organizationId_idx" ON "InventoryRequest"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_organizationId_idx" ON "InvoiceLineItem"("organizationId");

-- CreateIndex
CREATE INDEX "Job_organizationId_idx" ON "Job"("organizationId");

-- CreateIndex
CREATE INDEX "JobAddOn_organizationId_idx" ON "JobAddOn"("organizationId");

-- CreateIndex
CREATE INDEX "JobApplication_organizationId_idx" ON "JobApplication"("organizationId");

-- CreateIndex
CREATE INDEX "JobAssignment_organizationId_idx" ON "JobAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "JobAssignmentInvite_organizationId_idx" ON "JobAssignmentInvite"("organizationId");

-- CreateIndex
CREATE INDEX "JobBreak_organizationId_idx" ON "JobBreak"("organizationId");

-- CreateIndex
CREATE INDEX "JobChatMessage_organizationId_idx" ON "JobChatMessage"("organizationId");

-- CreateIndex
CREATE INDEX "JobChecklist_organizationId_idx" ON "JobChecklist"("organizationId");

-- CreateIndex
CREATE INDEX "JobChecklistItem_organizationId_idx" ON "JobChecklistItem"("organizationId");

-- CreateIndex
CREATE INDEX "JobLog_organizationId_idx" ON "JobLog"("organizationId");

-- CreateIndex
CREATE INDEX "JobPhoto_organizationId_idx" ON "JobPhoto"("organizationId");

-- CreateIndex
CREATE INDEX "JobProductUsage_organizationId_idx" ON "JobProductUsage"("organizationId");

-- CreateIndex
CREATE INDEX "JobRatingToken_organizationId_idx" ON "JobRatingToken"("organizationId");

-- CreateIndex
CREATE INDEX "JobWorkSession_organizationId_idx" ON "JobWorkSession"("organizationId");

-- CreateIndex
CREATE INDEX "KitTemplate_organizationId_idx" ON "KitTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "KitTemplateItem_organizationId_idx" ON "KitTemplateItem"("organizationId");

-- CreateIndex
CREATE INDEX "LandingPage_organizationId_idx" ON "LandingPage"("organizationId");

-- CreateIndex
CREATE INDEX "Lead_organizationId_idx" ON "Lead"("organizationId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_organizationId_idx" ON "MarketingCampaign"("organizationId");

-- CreateIndex
CREATE INDEX "NotificationSetting_organizationId_idx" ON "NotificationSetting"("organizationId");

-- CreateIndex
CREATE INDEX "PageVisit_organizationId_idx" ON "PageVisit"("organizationId");

-- CreateIndex
CREATE INDEX "PayPeriod_organizationId_idx" ON "PayPeriod"("organizationId");

-- CreateIndex
CREATE INDEX "Payout_organizationId_idx" ON "Payout"("organizationId");

-- CreateIndex
CREATE INDEX "PricingRule_organizationId_idx" ON "PricingRule"("organizationId");

-- CreateIndex
CREATE INDEX "Product_organizationId_idx" ON "Product"("organizationId");

-- CreateIndex
CREATE INDEX "ProductLink_organizationId_idx" ON "ProductLink"("organizationId");

-- CreateIndex
CREATE INDEX "PromoCode_organizationId_idx" ON "PromoCode"("organizationId");

-- CreateIndex
CREATE INDEX "PropertyDefinition_organizationId_idx" ON "PropertyDefinition"("organizationId");

-- CreateIndex
CREATE INDEX "QuoteRequest_organizationId_idx" ON "QuoteRequest"("organizationId");

-- CreateIndex
CREATE INDEX "RagWash_organizationId_idx" ON "RagWash"("organizationId");

-- CreateIndex
CREATE INDEX "RecurringCancellation_organizationId_idx" ON "RecurringCancellation"("organizationId");

-- CreateIndex
CREATE INDEX "ReviewPhoto_organizationId_idx" ON "ReviewPhoto"("organizationId");

-- CreateIndex
CREATE INDEX "SalesArea_organizationId_idx" ON "SalesArea"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceArea_organizationId_idx" ON "ServiceArea"("organizationId");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_idx" ON "Supplier"("organizationId");

-- CreateIndex
CREATE INDEX "SupplierPrice_organizationId_idx" ON "SupplierPrice"("organizationId");

-- CreateIndex
CREATE INDEX "Target_organizationId_idx" ON "Target"("organizationId");

-- CreateIndex
CREATE INDEX "TrainingModule_organizationId_idx" ON "TrainingModule"("organizationId");

-- CreateIndex
CREATE INDEX "TrainingProgress_organizationId_idx" ON "TrainingProgress"("organizationId");

-- CreateIndex
CREATE INDEX "TrainingQuiz_organizationId_idx" ON "TrainingQuiz"("organizationId");

-- CreateIndex
CREATE INDEX "Transaction_organizationId_idx" ON "Transaction"("organizationId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "Waitlist_organizationId_idx" ON "Waitlist"("organizationId");

-- CreateIndex
CREATE INDEX "WashPayout_organizationId_idx" ON "WashPayout"("organizationId");

-- CreateIndex
CREATE INDEX "WebhookEvent_organizationId_idx" ON "WebhookEvent"("organizationId");

-- CreateIndex
CREATE INDEX "Withdrawal_organizationId_idx" ON "Withdrawal"("organizationId");

