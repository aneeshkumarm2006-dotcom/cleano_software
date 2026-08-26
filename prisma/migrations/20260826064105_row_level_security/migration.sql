-- Row-level security: the database refuses to show or accept another
-- organization's rows, whatever the application asks for.
--
-- This is the layer that survives a mistake in application code. The scoped
-- Prisma client is the first line and gives good errors; this one holds even
-- when something bypasses it -- a raw query, a new endpoint, a future
-- refactor that forgets.
--
-- Two details that make the difference between a real policy and a decorative
-- one:
--
--   USING alone would filter reads while still letting a write store a row
--   belonging to someone else. WITH CHECK covers the write side, so both are
--   declared.
--
--   A table's owner is exempt from its own policies, so FORCE is set. It is
--   belt and braces here -- the app connects as awer_app, which owns nothing --
--   but it means the policies still bite if ownership ever changes.
--
-- The tenant is read from a session variable set by the application for the
-- duration of each statement. current_setting(..., true) returns NULL when it
-- has not been set, and "organizationId" = NULL is never true, so an
-- unconfigured connection sees nothing at all rather than everything. Failing
-- closed is the whole point.
--
-- Organization itself is deliberately NOT protected: resolving which tenant a
-- request belongs to has to happen before the tenant is known. Nor are
-- better-auth's Account, Session and Verification, which carry no business data
-- and are addressed by token.

ALTER TABLE "ActivityLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ActivityLog_tenant_isolation" ON "ActivityLog";
CREATE POLICY "ActivityLog_tenant_isolation" ON "ActivityLog"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AdSpendImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdSpendImport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AdSpendImport_tenant_isolation" ON "AdSpendImport";
CREATE POLICY "AdSpendImport_tenant_isolation" ON "AdSpendImport"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Alert" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Alert_tenant_isolation" ON "Alert";
CREATE POLICY "Alert_tenant_isolation" ON "Alert"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AlertRoutingRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AlertRoutingRule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AlertRoutingRule_tenant_isolation" ON "AlertRoutingRule";
CREATE POLICY "AlertRoutingRule_tenant_isolation" ON "AlertRoutingRule"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Announcement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Announcement_tenant_isolation" ON "Announcement";
CREATE POLICY "Announcement_tenant_isolation" ON "Announcement"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AnnouncementReaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnnouncementReaction" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AnnouncementReaction_tenant_isolation" ON "AnnouncementReaction";
CREATE POLICY "AnnouncementReaction_tenant_isolation" ON "AnnouncementReaction"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AppSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSetting" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AppSetting_tenant_isolation" ON "AppSetting";
CREATE POLICY "AppSetting_tenant_isolation" ON "AppSetting"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ApplicantInviteToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApplicantInviteToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ApplicantInviteToken_tenant_isolation" ON "ApplicantInviteToken";
CREATE POLICY "ApplicantInviteToken_tenant_isolation" ON "ApplicantInviteToken"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ApplicantMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApplicantMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ApplicantMessage_tenant_isolation" ON "ApplicantMessage";
CREATE POLICY "ApplicantMessage_tenant_isolation" ON "ApplicantMessage"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AvailabilityException" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AvailabilityException" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AvailabilityException_tenant_isolation" ON "AvailabilityException";
CREATE POLICY "AvailabilityException_tenant_isolation" ON "AvailabilityException"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Budget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Budget" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Budget_tenant_isolation" ON "Budget";
CREATE POLICY "Budget_tenant_isolation" ON "Budget"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "BudgetCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BudgetCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "BudgetCategory_tenant_isolation" ON "BudgetCategory";
CREATE POLICY "BudgetCategory_tenant_isolation" ON "BudgetCategory"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ChatConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatConversation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ChatConversation_tenant_isolation" ON "ChatConversation";
CREATE POLICY "ChatConversation_tenant_isolation" ON "ChatConversation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ChatMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ChatMessage_tenant_isolation" ON "ChatMessage";
CREATE POLICY "ChatMessage_tenant_isolation" ON "ChatMessage"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ChecklistTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ChecklistTemplate_tenant_isolation" ON "ChecklistTemplate";
CREATE POLICY "ChecklistTemplate_tenant_isolation" ON "ChecklistTemplate"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ChecklistTemplateItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistTemplateItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ChecklistTemplateItem_tenant_isolation" ON "ChecklistTemplateItem";
CREATE POLICY "ChecklistTemplateItem_tenant_isolation" ON "ChecklistTemplateItem"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CleanerStrike" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CleanerStrike" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "CleanerStrike_tenant_isolation" ON "CleanerStrike";
CREATE POLICY "CleanerStrike_tenant_isolation" ON "CleanerStrike"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Client_tenant_isolation" ON "Client";
CREATE POLICY "Client_tenant_isolation" ON "Client"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ClientAddress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientAddress" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ClientAddress_tenant_isolation" ON "ClientAddress";
CREATE POLICY "ClientAddress_tenant_isolation" ON "ClientAddress"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ClientCardSetupToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientCardSetupToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ClientCardSetupToken_tenant_isolation" ON "ClientCardSetupToken";
CREATE POLICY "ClientCardSetupToken_tenant_isolation" ON "ClientCardSetupToken"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ClientPaymentMethod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientPaymentMethod" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ClientPaymentMethod_tenant_isolation" ON "ClientPaymentMethod";
CREATE POLICY "ClientPaymentMethod_tenant_isolation" ON "ClientPaymentMethod"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Commission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Commission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Commission_tenant_isolation" ON "Commission";
CREATE POLICY "Commission_tenant_isolation" ON "Commission"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Complaint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Complaint" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Complaint_tenant_isolation" ON "Complaint";
CREATE POLICY "Complaint_tenant_isolation" ON "Complaint"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Contact_tenant_isolation" ON "Contact";
CREATE POLICY "Contact_tenant_isolation" ON "Contact"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ContactActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactActivity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ContactActivity_tenant_isolation" ON "ContactActivity";
CREATE POLICY "ContactActivity_tenant_isolation" ON "ContactActivity"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Document_tenant_isolation" ON "Document";
CREATE POLICY "Document_tenant_isolation" ON "Document"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DocumentAccessLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentAccessLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "DocumentAccessLog_tenant_isolation" ON "DocumentAccessLog";
CREATE POLICY "DocumentAccessLog_tenant_isolation" ON "DocumentAccessLog"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DocumentSignature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentSignature" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "DocumentSignature_tenant_isolation" ON "DocumentSignature";
CREATE POLICY "DocumentSignature_tenant_isolation" ON "DocumentSignature"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DuplicateRejection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DuplicateRejection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "DuplicateRejection_tenant_isolation" ON "DuplicateRejection";
CREATE POLICY "DuplicateRejection_tenant_isolation" ON "DuplicateRejection"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "EmailLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EmailLog_tenant_isolation" ON "EmailLog";
CREATE POLICY "EmailLog_tenant_isolation" ON "EmailLog"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "EmployeeAvailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeAvailability" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EmployeeAvailability_tenant_isolation" ON "EmployeeAvailability";
CREATE POLICY "EmployeeAvailability_tenant_isolation" ON "EmployeeAvailability"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "EmployeeFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeFile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EmployeeFile_tenant_isolation" ON "EmployeeFile";
CREATE POLICY "EmployeeFile_tenant_isolation" ON "EmployeeFile"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "EmployeeProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeProduct" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EmployeeProduct_tenant_isolation" ON "EmployeeProduct";
CREATE POLICY "EmployeeProduct_tenant_isolation" ON "EmployeeProduct"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "EmployeeRating" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeRating" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EmployeeRating_tenant_isolation" ON "EmployeeRating";
CREATE POLICY "EmployeeRating_tenant_isolation" ON "EmployeeRating"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Faq" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Faq" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Faq_tenant_isolation" ON "Faq";
CREATE POLICY "Faq_tenant_isolation" ON "Faq"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "FaqCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FaqCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "FaqCategory_tenant_isolation" ON "FaqCategory";
CREATE POLICY "FaqCategory_tenant_isolation" ON "FaqCategory"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "FaqEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FaqEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "FaqEvent_tenant_isolation" ON "FaqEvent";
CREATE POLICY "FaqEvent_tenant_isolation" ON "FaqEvent"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "GiftCard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiftCard" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "GiftCard_tenant_isolation" ON "GiftCard";
CREATE POLICY "GiftCard_tenant_isolation" ON "GiftCard"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "GroupChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupChannel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "GroupChannel_tenant_isolation" ON "GroupChannel";
CREATE POLICY "GroupChannel_tenant_isolation" ON "GroupChannel"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "GroupChannelMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupChannelMember" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "GroupChannelMember_tenant_isolation" ON "GroupChannelMember";
CREATE POLICY "GroupChannelMember_tenant_isolation" ON "GroupChannelMember"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "GroupChannelRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupChannelRead" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "GroupChannelRead_tenant_isolation" ON "GroupChannelRead";
CREATE POLICY "GroupChannelRead_tenant_isolation" ON "GroupChannelRead"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "GroupMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "GroupMessage_tenant_isolation" ON "GroupMessage";
CREATE POLICY "GroupMessage_tenant_isolation" ON "GroupMessage"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InventoryChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryChange" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "InventoryChange_tenant_isolation" ON "InventoryChange";
CREATE POLICY "InventoryChange_tenant_isolation" ON "InventoryChange"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InventoryCheckout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryCheckout" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "InventoryCheckout_tenant_isolation" ON "InventoryCheckout";
CREATE POLICY "InventoryCheckout_tenant_isolation" ON "InventoryCheckout"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InventoryCheckoutItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryCheckoutItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "InventoryCheckoutItem_tenant_isolation" ON "InventoryCheckoutItem";
CREATE POLICY "InventoryCheckoutItem_tenant_isolation" ON "InventoryCheckoutItem"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InventoryFlag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryFlag" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "InventoryFlag_tenant_isolation" ON "InventoryFlag";
CREATE POLICY "InventoryFlag_tenant_isolation" ON "InventoryFlag"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InventoryLocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLocation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "InventoryLocation_tenant_isolation" ON "InventoryLocation";
CREATE POLICY "InventoryLocation_tenant_isolation" ON "InventoryLocation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InventoryLocationStock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLocationStock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "InventoryLocationStock_tenant_isolation" ON "InventoryLocationStock";
CREATE POLICY "InventoryLocationStock_tenant_isolation" ON "InventoryLocationStock"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InventoryRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "InventoryRequest_tenant_isolation" ON "InventoryRequest";
CREATE POLICY "InventoryRequest_tenant_isolation" ON "InventoryRequest"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Invoice_tenant_isolation" ON "Invoice";
CREATE POLICY "Invoice_tenant_isolation" ON "Invoice"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InvoiceLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLineItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "InvoiceLineItem_tenant_isolation" ON "InvoiceLineItem";
CREATE POLICY "InvoiceLineItem_tenant_isolation" ON "InvoiceLineItem"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Job" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Job_tenant_isolation" ON "Job";
CREATE POLICY "Job_tenant_isolation" ON "Job"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobAddOn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobAddOn" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobAddOn_tenant_isolation" ON "JobAddOn";
CREATE POLICY "JobAddOn_tenant_isolation" ON "JobAddOn"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobApplication" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobApplication_tenant_isolation" ON "JobApplication";
CREATE POLICY "JobApplication_tenant_isolation" ON "JobApplication"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobAssignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobAssignment_tenant_isolation" ON "JobAssignment";
CREATE POLICY "JobAssignment_tenant_isolation" ON "JobAssignment"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobAssignmentInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobAssignmentInvite" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobAssignmentInvite_tenant_isolation" ON "JobAssignmentInvite";
CREATE POLICY "JobAssignmentInvite_tenant_isolation" ON "JobAssignmentInvite"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobBreak" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobBreak" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobBreak_tenant_isolation" ON "JobBreak";
CREATE POLICY "JobBreak_tenant_isolation" ON "JobBreak"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobChatMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobChatMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobChatMessage_tenant_isolation" ON "JobChatMessage";
CREATE POLICY "JobChatMessage_tenant_isolation" ON "JobChatMessage"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobChecklist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobChecklist" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobChecklist_tenant_isolation" ON "JobChecklist";
CREATE POLICY "JobChecklist_tenant_isolation" ON "JobChecklist"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobChecklistItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobChecklistItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobChecklistItem_tenant_isolation" ON "JobChecklistItem";
CREATE POLICY "JobChecklistItem_tenant_isolation" ON "JobChecklistItem"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobLog_tenant_isolation" ON "JobLog";
CREATE POLICY "JobLog_tenant_isolation" ON "JobLog"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobPhoto" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobPhoto_tenant_isolation" ON "JobPhoto";
CREATE POLICY "JobPhoto_tenant_isolation" ON "JobPhoto"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobProductUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobProductUsage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobProductUsage_tenant_isolation" ON "JobProductUsage";
CREATE POLICY "JobProductUsage_tenant_isolation" ON "JobProductUsage"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobRatingToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobRatingToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobRatingToken_tenant_isolation" ON "JobRatingToken";
CREATE POLICY "JobRatingToken_tenant_isolation" ON "JobRatingToken"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "JobWorkSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobWorkSession" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobWorkSession_tenant_isolation" ON "JobWorkSession";
CREATE POLICY "JobWorkSession_tenant_isolation" ON "JobWorkSession"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "KitTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KitTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "KitTemplate_tenant_isolation" ON "KitTemplate";
CREATE POLICY "KitTemplate_tenant_isolation" ON "KitTemplate"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "KitTemplateItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KitTemplateItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "KitTemplateItem_tenant_isolation" ON "KitTemplateItem";
CREATE POLICY "KitTemplateItem_tenant_isolation" ON "KitTemplateItem"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "LandingPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LandingPage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "LandingPage_tenant_isolation" ON "LandingPage";
CREATE POLICY "LandingPage_tenant_isolation" ON "LandingPage"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lead_tenant_isolation" ON "Lead";
CREATE POLICY "Lead_tenant_isolation" ON "Lead"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "MarketingCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingCampaign" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "MarketingCampaign_tenant_isolation" ON "MarketingCampaign";
CREATE POLICY "MarketingCampaign_tenant_isolation" ON "MarketingCampaign"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "NotificationSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationSetting" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "NotificationSetting_tenant_isolation" ON "NotificationSetting";
CREATE POLICY "NotificationSetting_tenant_isolation" ON "NotificationSetting"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PageVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PageVisit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PageVisit_tenant_isolation" ON "PageVisit";
CREATE POLICY "PageVisit_tenant_isolation" ON "PageVisit"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PayPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayPeriod" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PayPeriod_tenant_isolation" ON "PayPeriod";
CREATE POLICY "PayPeriod_tenant_isolation" ON "PayPeriod"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Payout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payout" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Payout_tenant_isolation" ON "Payout";
CREATE POLICY "Payout_tenant_isolation" ON "Payout"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PricingRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PricingRule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PricingRule_tenant_isolation" ON "PricingRule";
CREATE POLICY "PricingRule_tenant_isolation" ON "PricingRule"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Product_tenant_isolation" ON "Product";
CREATE POLICY "Product_tenant_isolation" ON "Product"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ProductLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductLink" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ProductLink_tenant_isolation" ON "ProductLink";
CREATE POLICY "ProductLink_tenant_isolation" ON "ProductLink"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PromoCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromoCode" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PromoCode_tenant_isolation" ON "PromoCode";
CREATE POLICY "PromoCode_tenant_isolation" ON "PromoCode"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PropertyDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PropertyDefinition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PropertyDefinition_tenant_isolation" ON "PropertyDefinition";
CREATE POLICY "PropertyDefinition_tenant_isolation" ON "PropertyDefinition"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "QuoteRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QuoteRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "QuoteRequest_tenant_isolation" ON "QuoteRequest";
CREATE POLICY "QuoteRequest_tenant_isolation" ON "QuoteRequest"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RagWash" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RagWash" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "RagWash_tenant_isolation" ON "RagWash";
CREATE POLICY "RagWash_tenant_isolation" ON "RagWash"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RecurringCancellation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringCancellation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "RecurringCancellation_tenant_isolation" ON "RecurringCancellation";
CREATE POLICY "RecurringCancellation_tenant_isolation" ON "RecurringCancellation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ReviewPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewPhoto" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ReviewPhoto_tenant_isolation" ON "ReviewPhoto";
CREATE POLICY "ReviewPhoto_tenant_isolation" ON "ReviewPhoto"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SalesArea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesArea" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SalesArea_tenant_isolation" ON "SalesArea";
CREATE POLICY "SalesArea_tenant_isolation" ON "SalesArea"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ServiceArea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceArea" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ServiceArea_tenant_isolation" ON "ServiceArea";
CREATE POLICY "ServiceArea_tenant_isolation" ON "ServiceArea"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Supplier_tenant_isolation" ON "Supplier";
CREATE POLICY "Supplier_tenant_isolation" ON "Supplier"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SupplierPrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierPrice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SupplierPrice_tenant_isolation" ON "SupplierPrice";
CREATE POLICY "SupplierPrice_tenant_isolation" ON "SupplierPrice"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Target" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Target" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Target_tenant_isolation" ON "Target";
CREATE POLICY "Target_tenant_isolation" ON "Target"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "TrainingModule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingModule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TrainingModule_tenant_isolation" ON "TrainingModule";
CREATE POLICY "TrainingModule_tenant_isolation" ON "TrainingModule"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "TrainingProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingProgress" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TrainingProgress_tenant_isolation" ON "TrainingProgress";
CREATE POLICY "TrainingProgress_tenant_isolation" ON "TrainingProgress"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "TrainingQuiz" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingQuiz" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TrainingQuiz_tenant_isolation" ON "TrainingQuiz";
CREATE POLICY "TrainingQuiz_tenant_isolation" ON "TrainingQuiz"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Transaction_tenant_isolation" ON "Transaction";
CREATE POLICY "Transaction_tenant_isolation" ON "Transaction"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User_tenant_isolation" ON "User";
CREATE POLICY "User_tenant_isolation" ON "User"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Waitlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Waitlist" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Waitlist_tenant_isolation" ON "Waitlist";
CREATE POLICY "Waitlist_tenant_isolation" ON "Waitlist"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "WashPayout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WashPayout" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "WashPayout_tenant_isolation" ON "WashPayout";
CREATE POLICY "WashPayout_tenant_isolation" ON "WashPayout"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "WebhookEvent_tenant_isolation" ON "WebhookEvent";
CREATE POLICY "WebhookEvent_tenant_isolation" ON "WebhookEvent"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Withdrawal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Withdrawal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Withdrawal_tenant_isolation" ON "Withdrawal";
CREATE POLICY "Withdrawal_tenant_isolation" ON "Withdrawal"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

