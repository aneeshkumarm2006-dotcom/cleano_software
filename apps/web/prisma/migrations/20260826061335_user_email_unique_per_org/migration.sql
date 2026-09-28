-- DropIndex
DROP INDEX "public"."User_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

