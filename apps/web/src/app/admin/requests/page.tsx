import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/lib/org-db";
import RequestsPageClient from "./RequestsPageClient";

export default async function RequestsPage() {
  await requireAdmin();

  const jobs = await db.job.findMany({
    where: {
      // Archived jobs don't raise open requests (new fix list item 1).
      deletedAt: null,
      OR: [
        { cancellationRequestedAt: { not: null } },
        { rescheduleRequestedAt: { not: null } },
      ],
    },
    orderBy: [
      { cancellationRequestedAt: "desc" },
      { rescheduleRequestedAt: "desc" },
    ],
    include: {
      client: { select: { id: true, name: true, email: true, phone: true } },
      cleaners: { select: { id: true, name: true } },
    },
    take: 200,
  });

  const serialized = jobs.map((j) => ({
    id: j.id,
    jobNumber: j.jobNumber,
    status: j.status,
    isFlexible: j.isFlexible,
    startTime: j.startTime.toISOString(),
    location: j.location,
    jobType: j.jobType,
    price: j.price,
    cancellationRequestedAt: j.cancellationRequestedAt?.toISOString() ?? null,
    rescheduleRequestedAt: j.rescheduleRequestedAt?.toISOString() ?? null,
    client: j.client
      ? {
          id: j.client.id,
          name: j.client.name,
          email: j.client.email,
          phone: j.client.phone,
        }
      : null,
    cleaners: j.cleaners,
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <RequestsPageClient jobs={serialized} />
    </div>
  );
}
