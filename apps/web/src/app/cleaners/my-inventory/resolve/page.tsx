import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import { checkEquipmentForJob } from "@/app/admin/actions/checkEquipmentForJob";
import { getLocationStock } from "@/app/admin/actions/getLocationStock";
import type { ProductLocationStock } from "@/app/admin/actions/getLocationStock.types";
import ResolveClient from "./ResolveClient";

type SearchParams = Promise<{
  jobId?: string;
}>;

export default async function ResolvePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/cleanos/login");
  }

  const params = await searchParams;
  const jobId = params.jobId;

  if (!jobId) {
    return (
      <div className="h-full overflow-hidden overflow-y-auto p-8">
        <ResolveClient job={null} missing={[]} stockByProduct={{}} />
      </div>
    );
  }

  const equipmentResult = await checkEquipmentForJob(jobId);

  if (!equipmentResult.success) {
    return (
      <div className="h-full overflow-hidden overflow-y-auto p-8">
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-4">
          {equipmentResult.error}
        </div>
      </div>
    );
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      clientName: true,
      jobDate: true,
      jobType: true,
      location: true,
      addOns: { select: { name: true } },
    },
  });

  const productIds = equipmentResult.result.missing.map((m) => m.productId);

  let stockByProduct: Record<string, ProductLocationStock> = {};
  if (productIds.length > 0) {
    const stockResult = await getLocationStock(productIds);
    if (stockResult.success) {
      stockByProduct = Object.fromEntries(
        stockResult.products.map((p) => [p.productId, p])
      );
    }
  }

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <ResolveClient
        job={
          job
            ? {
                id: job.id,
                clientName: job.clientName,
                jobDate: job.jobDate ? job.jobDate.toISOString() : null,
                jobType: job.jobType,
                location: job.location,
                addOns: job.addOns.map((a) => a.name),
              }
            : null
        }
        missing={equipmentResult.result.missing}
        stockByProduct={stockByProduct}
      />
    </div>
  );
}
