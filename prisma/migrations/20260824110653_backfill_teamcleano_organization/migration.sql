-- Step 2: found the first organization and claim every existing row for it.
--
-- This database began life as TeamCleano's single-tenant system, so every row
-- in it belongs to them by definition. Idempotent: the insert tolerates an
-- existing row and each update only touches rows still unclaimed, so a re-run
-- (or a retry after a dropped connection) is a no-op.
--
-- Data only. No schema changes, nothing dropped, nothing rewritten.

INSERT INTO "Organization" ("id", "slug", "name", "status", "plan", "timezone", "createdAt", "updatedAt")
VALUES ('org_teamcleano', 'teamcleano', 'TeamCleano', 'ACTIVE', 'ORGANIZATION', 'America/Toronto', now(), now())
ON CONFLICT ("id") DO NOTHING;

UPDATE "ActivityLog" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "AdSpendImport" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Alert" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "AlertRoutingRule" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Announcement" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "AnnouncementReaction" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "AppSetting" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ApplicantInviteToken" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ApplicantMessage" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "AvailabilityException" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Budget" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "BudgetCategory" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ChatConversation" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ChatMessage" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ChecklistTemplate" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ChecklistTemplateItem" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "CleanerStrike" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Client" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ClientAddress" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ClientCardSetupToken" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ClientPaymentMethod" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Commission" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Complaint" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Contact" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ContactActivity" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Document" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "DocumentAccessLog" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "DocumentSignature" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "DuplicateRejection" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "EmailLog" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "EmployeeAvailability" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "EmployeeFile" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "EmployeeProduct" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "EmployeeRating" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Faq" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "FaqCategory" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "FaqEvent" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "GiftCard" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "GroupChannel" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "GroupChannelMember" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "GroupChannelRead" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "GroupMessage" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "InventoryChange" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "InventoryCheckout" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "InventoryCheckoutItem" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "InventoryFlag" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "InventoryLocation" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "InventoryLocationStock" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "InventoryRequest" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Invoice" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "InvoiceLineItem" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Job" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobAddOn" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobApplication" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobAssignment" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobAssignmentInvite" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobBreak" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobChatMessage" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobChecklist" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobChecklistItem" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobLog" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobPhoto" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobProductUsage" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobRatingToken" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "JobWorkSession" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "KitTemplate" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "KitTemplateItem" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "LandingPage" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Lead" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "MarketingCampaign" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "NotificationSetting" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "PageVisit" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "PayPeriod" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Payout" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "PricingRule" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Product" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ProductLink" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "PromoCode" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "PropertyDefinition" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "QuoteRequest" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "RagWash" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "RecurringCancellation" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ReviewPhoto" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "SalesArea" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "ServiceArea" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Supplier" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "SupplierPrice" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Target" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "TrainingModule" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "TrainingProgress" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "TrainingQuiz" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Transaction" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "User" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Waitlist" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "WashPayout" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "WebhookEvent" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
UPDATE "Withdrawal" SET "organizationId" = 'org_teamcleano' WHERE "organizationId" IS NULL;
