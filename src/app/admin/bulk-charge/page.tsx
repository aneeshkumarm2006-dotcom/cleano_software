import { requireOwnerAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import { resolveAmountDue } from "@/lib/job-billing";
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
      // Both feed resolveAmountDue, so this preview shows exactly what
      // bulkChargeJobs -> chargeJob will put on the card.
      totalAmount: true,
      depositPaid: true,
      // Both of these feed resolveAmountDue too — without depositAmount the
      // preview would show $180 more than bulkChargeJobs actually charges on a
      // post-construction job (Stage 11).
      depositAmount: true,
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
          amount: resolveAmountDue(j),
          completedAt: j.clockOutTime?.toISOString() ?? null,
          hasCardOnFile: Boolean(
            j.client?.defaultPaymentMethodId && j.client?.stripeCustomerId
          ),
        }))}
      />
    </div>
  );
}
