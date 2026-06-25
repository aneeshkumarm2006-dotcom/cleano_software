import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import BulkChargeClient from "./BulkChargeClient";

export default async function BulkChargePage() {
  await requireAdmin();

  const jobs = await db.job.findMany({
    where: {
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
