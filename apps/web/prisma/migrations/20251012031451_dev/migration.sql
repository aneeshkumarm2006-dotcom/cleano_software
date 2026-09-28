-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."JobLogAction" AS ENUM ('CREATED', 'UPDATED', 'CLOCKED_IN', 'CLOCKED_OUT', 'STATUS_CHANGED', 'PAYMENT_RECEIVED', 'INVOICE_SENT', 'PRODUCT_USED', 'NOTE_ADDED', 'CLEANER_ADDED', 'CLEANER_REMOVED');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('CREATED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "public"."Roles" AS ENUM ('OWNER', 'ADMIN', 'EMPLOYEE');

-- CreateTable
CREATE TABLE "public"."Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "idToken" TEXT,
    "password" TEXT,
    "providerId" TEXT NOT NULL,
    "refreshToken" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmployeeProduct" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "productId" TEXT,
    "kitId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" "public"."RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Job" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "jobType" TEXT,
    "jobDate" TIMESTAMP(3),
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "clockInTime" TIMESTAMP(3),
    "clockOutTime" TIMESTAMP(3),
    "status" "public"."JobStatus" NOT NULL DEFAULT 'CREATED',
    "price" DOUBLE PRECISION,
    "employeePay" DOUBLE PRECISION,
    "totalTip" DOUBLE PRECISION,
    "parking" DOUBLE PRECISION,
    "paymentReceived" BOOLEAN NOT NULL DEFAULT false,
    "invoiceSent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JobLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "public"."JobLogAction" NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JobProductUsage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "inventoryBefore" DOUBLE PRECISION,
    "inventoryAfter" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobProductUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL,
    "costPerUnit" DOUBLE PRECISION NOT NULL,
    "stockLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "token" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "phone" TEXT,
    "role" "public"."Roles" NOT NULL DEFAULT 'EMPLOYEE',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_JobCleaners" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_JobCleaners_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "EmployeeProduct_employeeId_idx" ON "public"."EmployeeProduct"("employeeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProduct_employeeId_productId_key" ON "public"."EmployeeProduct"("employeeId" ASC, "productId" ASC);

-- CreateIndex
CREATE INDEX "EmployeeProduct_productId_idx" ON "public"."EmployeeProduct"("productId" ASC);

-- CreateIndex
CREATE INDEX "Job_clientName_idx" ON "public"."Job"("clientName" ASC);

-- CreateIndex
CREATE INDEX "Job_jobDate_idx" ON "public"."Job"("jobDate" ASC);

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "public"."Job"("status" ASC);

-- CreateIndex
CREATE INDEX "JobLog_createdAt_idx" ON "public"."JobLog"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "JobLog_jobId_idx" ON "public"."JobLog"("jobId" ASC);

-- CreateIndex
CREATE INDEX "JobLog_userId_idx" ON "public"."JobLog"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "JobProductUsage_jobId_productId_key" ON "public"."JobProductUsage"("jobId" ASC, "productId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "public"."Session"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE INDEX "_JobCleaners_B_index" ON "public"."_JobCleaners"("B" ASC);

-- AddForeignKey
ALTER TABLE "public"."Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmployeeProduct" ADD CONSTRAINT "EmployeeProduct_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmployeeProduct" ADD CONSTRAINT "EmployeeProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryRequest" ADD CONSTRAINT "InventoryRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Job" ADD CONSTRAINT "Job_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JobLog" ADD CONSTRAINT "JobLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JobLog" ADD CONSTRAINT "JobLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JobProductUsage" ADD CONSTRAINT "JobProductUsage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JobProductUsage" ADD CONSTRAINT "JobProductUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_JobCleaners" ADD CONSTRAINT "_JobCleaners_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_JobCleaners" ADD CONSTRAINT "_JobCleaners_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
