// ZZTEST scratch: READ-ONLY look at what a ZZTEST job actually stores.
// No writes anywhere in this file.
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const NAME = process.env.ZZ_NAME ?? "ZZTEST paycap";

try {
  const jobs = await prisma.job.findMany({
    where: { clientName: { contains: NAME } },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: {
      id: true,
      clientName: true,
      price: true,
      employeePay: true,
      employeePayIsManual: true,
      payType: true,
      requiredCleaners: true,
      notes: true,
      deletedAt: true,
      updatedAt: true,
      employeeId: true,
      cleaners: { select: { id: true, email: true } },
      assignments: { select: { cleanerId: true, payAmount: true, status: true } },
      addOns: { select: { name: true, price: true, quantity: true } },
    },
  });
  console.log("RESULT " + JSON.stringify(jobs, null, 1));
} finally {
  await prisma.$disconnect();
}
