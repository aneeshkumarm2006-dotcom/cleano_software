-- AlterTable
ALTER TABLE "ActivityLog" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AdSpendImport" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Alert" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AlertRoutingRule" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Announcement" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AnnouncementReaction" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AppSetting" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ApplicantInviteToken" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ApplicantMessage" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AvailabilityException" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Budget" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "BudgetCategory" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ChatConversation" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ChatMessage" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ChecklistTemplate" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ChecklistTemplateItem" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CleanerStrike" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ClientAddress" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ClientCardSetupToken" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ClientPaymentMethod" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Commission" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Complaint" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ContactActivity" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "DocumentAccessLog" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "DocumentSignature" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "DuplicateRejection" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "EmailLog" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "EmployeeAvailability" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "EmployeeFile" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "EmployeeProduct" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "EmployeeRating" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Faq" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "FaqCategory" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "FaqEvent" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GiftCard" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GroupChannel" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GroupChannelMember" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GroupChannelRead" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GroupMessage" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InventoryChange" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InventoryCheckout" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InventoryCheckoutItem" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InventoryFlag" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InventoryLocation" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InventoryLocationStock" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InventoryRequest" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InvoiceLineItem" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobAddOn" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobApplication" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobAssignment" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobAssignmentInvite" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobBreak" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobChatMessage" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobChecklist" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobChecklistItem" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobLog" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobPhoto" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobProductUsage" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobRatingToken" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobWorkSession" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "KitTemplate" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "KitTemplateItem" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "LandingPage" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "MarketingCampaign" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "NotificationSetting" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PageVisit" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PayPeriod" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Payout" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PricingRule" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ProductLink" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PromoCode" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PropertyDefinition" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "QuoteRequest" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "RagWash" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "RecurringCancellation" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ReviewPhoto" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "SalesArea" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ServiceArea" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "SupplierPrice" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Target" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "TrainingModule" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "TrainingProgress" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "TrainingQuiz" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Waitlist" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "WashPayout" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "WebhookEvent" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Withdrawal" ALTER COLUMN "organizationId" SET NOT NULL;

