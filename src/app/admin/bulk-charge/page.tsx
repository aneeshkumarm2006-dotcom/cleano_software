import { requireOwnerAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import BulkChargeClient from "./BulkChargeClient";

export default async function BulkChargePage() {
  // Charges real customer cards in bulk — OWNER/ADMIN only, matching the guard
  // inside `bulkChargeJobs`. `requireAdmin` would admit OPS_MANAGER/FIELD_LEAD.
  await requireOwnerAdmin();

  const jobs = await db.job.findMany({
    where: {
      // Archived jobs are never charged (new fix list item 1).
      deletedAt: null,
      paymentReceived: false,
      status: "COMPLETED",
      isCashJob: false,
    },
    orderBy: { clockOutTime: "desc" },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      price: true,
      discountAmount: true,
      jobType: true,
      clockOutTime: true,
      client: { select: { defaultPaymentMethodId: true, stripeCustomerId: true } },
    },
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <BulkChargeClient
        jobs={jobs.map((j) => ({
          id: j.id,
          jobNumber: j.jobNumber,
          clientName: j.clientName,
          jobType: j.jobType,
          amount: Math.max(0, (j.price ?? 0) - (j.discountAmount ?? 0)),
          completedAt: j.clockOutTime?.toISOString() ?? null,
          hasCardOnFile: Boolean(
            j.client?.defaultPaymentMethodId && j.client?.stripeCustomerId
          ),
        }))}
      />
    </div>
  );
}
