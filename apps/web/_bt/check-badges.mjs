// Fix 18 — the seven attention counts, read straight from the DB so the rendered
// badges can be compared against ground truth rather than against themselves.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const adminId = "EA7dYs0vBO4Kmfqf2b2TeD0b4p4Z8KmP";

const out = {
  requests: await db.job.count({
    where: {
      deletedAt: null,
      OR: [{ cancellationRequestedAt: { not: null } }, { rescheduleRequestedAt: { not: null } }],
    },
  }),
  applications: await db.jobApplication.count({ where: { status: "NEW", deletedAt: null } }),
  quotes: await db.quoteRequest.count({ where: { status: "NEW", deletedAt: null } }),
  documents: await db.documentSignature.count({ where: { employeeId: adminId, status: "PENDING" } }),
  leads: await db.lead.count({ where: { status: "NEW", deletedAt: null } }),
  payouts: await db.payPeriod.count({ where: { status: "PENDING_APPROVAL" } }),
  inventory: await db.inventoryRequest.count({ where: { status: "PENDING" } }),
};
console.log(JSON.stringify(out, null, 2));
await db.$disconnect();
